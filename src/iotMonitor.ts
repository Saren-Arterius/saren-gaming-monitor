import { CONFIG } from './config';
import { Redis } from "ioredis";

let redis: Redis | null = null;

interface Device {
    mac: string;
    ip: string;
    hostname: string;
}

// [packetLoss, min, max, avg, jitter]
type PingStats = [number, number, number, number, number];
interface DeviceMonitorData extends Device {
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

export class IOTMonitor {
    private data: DeviceMonitorData[] | null = null;
    private devices: Map<string, Device> = new Map();
    private isRunning = false;

    start() {
        if (!CONFIG.iotLeases) return;
        if (this.isRunning) return;
        
        if (!redis) {
            redis = new Redis();
        }

        this.isRunning = true;

        this.refreshLeases();

        // Refresh leases every minute
        setInterval(() => this.refreshLeases(), 60000);

        // Ping loop every 1s
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

    private async refreshLeases() {
        try {
            const file = Bun.file(CONFIG.iotLeases);
            const content = await file.text();
            const lines = content.trim().split('\n');

            const foundDevices = new Map<string, Device>();

            for (const line of lines) {
                // dnsmasq lease format: timestamps mac ip hostname clientid
                const parts = line.split(/\s+/);
                if (parts.length >= 4) {
                    const mac = parts[1];
                    const ip = parts[2];
                    const hostname = parts[3];
                    foundDevices.set(mac, { mac, ip, hostname });
                }
            }
            this.devices = foundDevices;
        } catch (e) {
            console.error("IOTMonitor: Error reading leases", e);
        }
    }

    private pingAll() {
        const timestamp = Date.now();
        this.devices.forEach((device) => {
            this.pingDevice(device, timestamp);
        });
    }

    private async pingDevice(device: Device, timestamp: number) {
        if (!redis) return;
        let ms = 5000;
        try {
            // ping -c 1 -W 1 <ip>
            // Linux ping uses -W for timeout in seconds
            const proc = Bun.spawn(["ping", "-c", "1", "-W", "5", device.ip], {
                stdout: "pipe",
                stderr: "pipe",
            });

            const exitCode = await proc.exited;

            if (exitCode === 0) {
                const output = await new Response(proc.stdout).text();
                // Parse time=xx.xx ms
                const match = output.match(/time=([\d.]+)/);
                if (match && match[1]) {
                    ms = parseFloat(match[1]);
                    // Safety clip if ping returns weird >1000 value despite timeout flag
                    if (ms > 5000) ms = 5000;
                }
            }
        } catch (error) {
            ms = 5000;
        }

        const streamKey = `iot:stream:${device.mac}`;
        await redis.xadd(streamKey, '*', 'ts', timestamp.toString(), 'ms', ms.toString());
    }

    private async retention() {
        if (!redis) return;
        // retain 86400 records (24h * 60m * 60s)
        for (const mac of this.devices.keys()) {
            const streamKey = `iot:stream:${mac}`;
            await redis.xtrim(streamKey, 'MAXLEN', 86400 / 5);
        }
    }

    private async aggregateData() {
        if (!redis) return;
        const now = Date.now();
        const results: DeviceMonitorData[] = [];
        const timeframes = {
            "1m": 60 * 1000,
            "5m": 5 * 60 * 1000,
            "15m": 15 * 60 * 1000,
            "1h": 3600 * 1000,
            "3h": 3 * 3600 * 1000,
            "12h": 12 * 3600 * 1000,
            "24h": 24 * 3600 * 1000
        };

        for (const device of this.devices.values()) {
            const streamKey = `iot:stream:${device.mac}`;

            // Fetch last 24h of data
            const startRange = now - timeframes["24h"];
            const rawData = await redis.xrange(streamKey, startRange, '+');

            const points = rawData.map((entry: any) => {
                // entry format: [id, [key, val, key, val]]
                const fields = entry[1];
                let ts = 0;
                let ms = 5000;

                for (let i = 0; i < fields.length; i += 2) {
                    if (fields[i] === 'ts') ts = parseInt(fields[i + 1]);
                    if (fields[i] === 'ms') ms = parseFloat(fields[i + 1]);
                }
                return { ts, ms };
            });

            // Calculate aggregated stats for timeframes
            const statsObj: any = {};
            for (const [label, duration] of Object.entries(timeframes)) {
                const cutoff = now - duration;
                const relevantPoints = points.filter((p: any) => p.ts >= cutoff);
                statsObj[label] = this.calculateMetrics(relevantPoints);
            }

            // Calculate history (last 30 minutes)
            const history: PingStats[] = [];
            for (let i = 0; i < 30; i++) {
                const bucketEnd = now - (i * 60 * 1000);
                const bucketStart = now - ((i + 1) * 60 * 1000);

                const bucketPoints = points.filter((p: any) => p.ts >= bucketStart && p.ts < bucketEnd);
                history.push(this.calculateMetrics(bucketPoints));
            }

            if (statsObj['24h'][0] === 100) continue;

            results.push({
                mac: device.mac,
                ip: device.ip,
                hostname: device.hostname,
                stats: statsObj,
                history: history.reverse()
            });
        }

        this.data = results;
    }

    private calculateMetrics(points: { ts: number, ms: number }[]): PingStats {
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
                // Timeout
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

        // If no successful pings, reset min to 0 for cleaner UI
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
