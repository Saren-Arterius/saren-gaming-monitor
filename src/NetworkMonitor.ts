import { Redis } from "ioredis";

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

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Ping loop every 5s
        setInterval(() => this.pingAll(), 5000);

        // Retention policy every 1h
        setInterval(() => this.retention(), 3600 * 1000);

        // Aggregate stats every 1m (Wait 5s initially to allow first pings)
        setTimeout(() => {
            this.aggregateData();
            setInterval(() => this.aggregateData(), 60000);
        }, 5000);
    }

    getCachedData() {
        return this.data;
    }

    protected abstract getTargets(): T[];

    protected pingAll() {
        const timestamp = Date.now();
        this.getTargets().forEach((target) => {
            this.pingTarget(target, timestamp);
        });
    }

    protected async pingTarget(target: T, timestamp: number) {
        const redis = this.getRedis();
        let ms = 5000;
        try {
            const proc = Bun.spawn(["ping", "-c", "1", "-W", "5", target.address], {
                stdout: "pipe",
                stderr: "pipe",
            });

            const exitCode = await proc.exited;

            if (exitCode === 0) {
                const output = await new Response(proc.stdout).text();
                const match = output.match(/time=([\d.]+)/);
                if (match && match[1]) {
                    ms = parseFloat(match[1]);
                    if (ms > 5000) ms = 5000;
                }
            }
        } catch (error) {
            ms = 5000;
        }

        const streamKey = `${this.prefix}:stream:${target.id}`;
        await redis.xadd(streamKey, '*', 'ts', timestamp.toString(), 'ms', ms.toString());
    }

    protected async retention() {
        const redis = this.getRedis();
        for (const target of this.getTargets()) {
            const streamKey = `${this.prefix}:stream:${target.id}`;
            await redis.xtrim(streamKey, 'MAXLEN', 86400 / 5);
        }
    }

    protected async aggregateData() {
        const redis = this.getRedis();
        const now = Date.now();
        const results: D[] = [];
        const timeframes = {
            "1m": 60 * 1000,
            "5m": 5 * 60 * 1000,
            "15m": 15 * 60 * 1000,
            "1h": 3600 * 1000,
            "3h": 3 * 3600 * 1000,
            "12h": 12 * 3600 * 1000,
            "24h": 24 * 3600 * 1000
        };

        for (const target of this.getTargets()) {
            const streamKey = `${this.prefix}:stream:${target.id}`;

            const startRange = now - timeframes["24h"];
            const rawData = await redis.xrange(streamKey, startRange, '+');

            const points = rawData.map((entry: any) => {
                const fields = entry[1];
                let ts = 0;
                let ms = 5000;

                for (let i = 0; i < fields.length; i += 2) {
                    if (fields[i] === 'ts') ts = parseInt(fields[i + 1]);
                    if (fields[i] === 'ms') ms = parseFloat(fields[i + 1]);
                }
                return { ts, ms };
            });

            const statsObj: any = {};
            for (const [label, duration] of Object.entries(timeframes)) {
                const cutoff = now - duration;
                const relevantPoints = points.filter((p: any) => p.ts >= cutoff);
                statsObj[label] = this.calculateMetrics(relevantPoints);
            }

            const history: PingStats[] = [];
            for (let i = 0; i < 30; i++) {
                const bucketEnd = now - (i * 60 * 1000);
                const bucketStart = now - ((i + 1) * 60 * 1000);

                const bucketPoints = points.filter((p: any) => p.ts >= bucketStart && p.ts < bucketEnd);
                history.push(this.calculateMetrics(bucketPoints));
            }

            // Specific logic for IOTMonitor to skip dead devices in results
            if (this.prefix === 'iot' && statsObj['24h'][0] === 100) continue;

            results.push({
                ...target,
                stats: statsObj,
                history: history.reverse()
            } as unknown as D);
        }

        this.data = results;
    }

    protected calculateMetrics(points: { ts: number, ms: number }[]): PingStats {
        if (points.length === 0) {
            return [0, 0, 0, 0, 0];
        }

        let successCount = 0;
        let totalMs = 0;
        let min = 5000;
        let max = 0;
        let jitterSum = 0;
        let prevMs: number | null = null;
        let jitterCount = 0;

        for (const p of points) {
            if (p.ms >= 5000) {
                continue;
            }

            successCount++;
            totalMs += p.ms;
            if (p.ms < min) min = p.ms;
            if (p.ms > max) max = p.ms;

            if (prevMs !== null) {
                jitterSum += Math.abs(p.ms - prevMs);
                jitterCount++;
            }
            prevMs = p.ms;
        }

        const packetLoss = ((points.length - successCount) / points.length) * 100;
        const avg = successCount > 0 ? totalMs / successCount : 0;
        const jitter = jitterCount > 0 ? jitterSum / jitterCount : 0;

        if (successCount === 0) min = 0;

        return [
            parseFloat(packetLoss.toFixed(2)),
            parseFloat(min.toFixed(2)),
            parseFloat(max.toFixed(2)),
            parseFloat(avg.toFixed(2)),
            parseFloat(jitter.toFixed(2))
        ];
    }
}
