import { Redis } from "ioredis";
import { spawn } from "child_process";
import path from "path";

export type PingStats = [number, number, number, number, number];

export interface NetworkTarget {
    id: string;
    address: string;
    [key: string]: any;
}

export interface MonitorData extends NetworkTarget {
    stats: {
        "1m": PingStats;
        "5m": PingStats;
        "15m": PingStats;
        "1h": PingStats;
        "3h": PingStats;
        "12h": PingStats;
        "24h": PingStats;
    };
    history: PingStats[];
}

export abstract class NetworkMonitor<T extends NetworkTarget, D extends MonitorData> {
    protected data: D[] | null = null;
    protected isRunning = false;
    protected redis: Redis | null = null;
    protected abstract prefix: string;

    protected getRedis(): Redis {
        if (!this.redis) {
            this.redis = new Redis();
        }
        return this.redis;
    }

    private static rustServiceStarted = false;

    static startRustService() {
        if (this.rustServiceStarted) return;
        this.rustServiceStarted = true;

        const rustDir = path.join(process.cwd(), "rust-ping-service");
        const binaryPath = path.join(rustDir, "target/release/rust-ping-service");

        console.log(`Setting capabilities for ${binaryPath}...`);

        // Set capabilities to allow raw socket access for pinging without root
        const setcap = spawn("sudo", ["setcap", "cap_net_raw+ep", binaryPath]);

        setcap.on("close", (code) => {
            if (code !== 0) {
                console.error(`Failed to set capabilities, exit code: ${code}`);
            }

            console.log(`Starting Rust ping service in ${rustDir}...`);
            const child = spawn("cargo", ["run", "--release"], {
                cwd: rustDir,
                stdio: ["ignore", "pipe", "pipe"],
            });

            child.stdout.on("data", (data) => {
                process.stdout.write(`[Rust Stdout] ${data}`);
            });

            child.stderr.on("data", (data) => {
                process.stderr.write(`[Rust Stderr] ${data}`);
            });

            child.on("error", (err) => {
                console.error("Failed to start Rust service:", err);
            });

            child.on("close", (code) => {
                console.log(`Rust service exited with code ${code}`);
            });
        });
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Start Rust ping service (guarded by static flag)
        NetworkMonitor.startRustService();

        // Sync targets to Redis for Rust service
        this.syncTargets();
        setInterval(() => this.syncTargets(), 60000);

        // Aggregate stats every 1m (Wait 5s initially to allow first pings)
        setTimeout(() => {
            this.aggregateData();
            setInterval(() => this.aggregateData(), 60000);
        }, 5000);
    }

    protected async syncTargets() {
        const redis = this.getRedis();
        const targets = this.getTargets().map(t => ({
            id: t.id,
            address: t.address,
            prefix: this.prefix
        }));

        const key = `monitor:targets:${this.prefix}`;
        await redis.del(key);
        for (const target of targets) {
            await redis.rpush(key, JSON.stringify(target));
        }
    }

    getCachedData() {
        return this.data;
    }

    protected abstract getTargets(): T[];

    protected async aggregateData() {
        const redis = this.getRedis();
        const targets = this.getTargets();

        if (targets.length === 0) {
            this.data = [];
            return;
        }
        const keys = targets.map(t => `${this.prefix}:cache:${t.id}`);
        const cachedResults = await redis.mget(keys);
        const results: D[] = [];

        for (let i = 0; i < targets.length; i++) {
            const cached = cachedResults[i];
            if (cached) {
                const parsed = JSON.parse(cached);
                
                // Specific logic for IOTMonitor to skip dead devices in results
                if (this.prefix === 'iot' && parsed.stats['24h'][0] === 100) continue;

                results.push({
                    ...targets[i],
                    stats: parsed.stats,
                    history: parsed.history
                } as unknown as D);
            }
        }

        this.data = results;
    }
}
