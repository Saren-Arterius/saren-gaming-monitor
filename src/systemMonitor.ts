import { readFile } from 'fs/promises';
import { exec } from 'child_process';
import util from 'node:util';
import { CONFIG } from './config';
import { LastStats, SystemMetrics } from './types';

const execAsync = util.promisify(exec);

export class SystemMonitor {
    private lastStats: LastStats | null = null;
    private metrics: SystemMetrics | null = null;

    async collectData() {
        const [
            { stdout: sensors },
            stat,
            meminfo,
            diskstats,
            netdev,
            cpuinfo,
            ssdStats,
            ssd2Stats
        ] = await Promise.all([
            execAsync(CONFIG.commands.sensors.command),
            readFile(CONFIG.systemFiles.stat).then(b => b.toString()),
            readFile(CONFIG.systemFiles.meminfo).then(b => b.toString()),
            readFile(CONFIG.systemFiles.diskstats).then(b => b.toString()),
            readFile(CONFIG.systemFiles.netdev).then(b => b.toString()),
            readFile(CONFIG.systemFiles.cpuinfo).then(b => b.toString()),
            execAsync('df -ml / | tail -n 1'),
            execAsync('df -ml /mnt/storage | tail -n 1'),
        ]);

        return {
            sensors: JSON.parse(sensors),
            stat: stat.split('\n'),
            meminfo: meminfo.split('\n'),
            diskstats: diskstats.split('\n'),
            netdev: netdev.split('\n').map(l => l.trim()),
            cpuinfo: cpuinfo.split('\n'),
            ssdStats: ssdStats.stdout.split(' '),
            ssd2Stats: ssd2Stats.stdout.split(' ')
        };
    }

    transformSystemInfo(data) {
        const now = Date.now();

        console.log(data.ssdStats)
        let total = data.meminfo.find(line => line.startsWith('MemTotal:')).split(/\s+/)[1] / 1024;
        let avail = data.meminfo.find(line => line.startsWith('MemAvailable:')).split(/\s+/)[1] / 1024;
        let memUsed = total - avail;
        let memUsage = memUsed / total;

        let cpuMhzs = data.cpuinfo.filter(l => l.startsWith('cpu MHz')).map(s => parseFloat(s.split(':')[1]));

        const result = {
            temperatures: {
                cpu: Math.round(parseFloat(data.sensors[CONFIG.sensors.cpu.temperature][CONFIG.sensors.cpu.tempField][CONFIG.sensors.cpu.tempInput])),
                gpu: undefined,
                ssd: Math.round(parseFloat(data.sensors[CONFIG.sensors.ssd.temperature][CONFIG.sensors.ssd.tempField][CONFIG.sensors.ssd.tempInput])),
                ssd2: Math.round(parseFloat(data.sensors[CONFIG.sensors.ssd2.temperature][CONFIG.sensors.ssd2.tempField][CONFIG.sensors.ssd2.tempInput]))
            },
            usage: {
                cpu: 0,
                gpu: undefined,
                ram: Math.round(memUsage * 100),
                vram: undefined,
                ssd: parseInt(data.ssdStats[6]),
                ssd2: parseInt(data.ssd2Stats[6]),
            },
            usageMB: {
                ram: Math.round(memUsed),
                vram: undefined,
            },
            usageGB: {
                ssd: Math.round(parseInt(data.ssdStats[2]) / 1024),
                ssd2: Math.round(parseInt(data.ssd2Stats[2]) / 1024),
            },
            io: {
                diskRead: 0,
                diskWrite: 0,
                networkRx: 0,
                networkTx: 0
            },
            fanSpeed: {
                cpu: parseInt(data.sensors[CONFIG.sensors.fans.controller][CONFIG.sensors.fans.cpu.id][CONFIG.sensors.fans.cpu.input]),
                ssd: parseInt(data.sensors[CONFIG.sensors.fans.controller][CONFIG.sensors.fans.ssd.id][CONFIG.sensors.fans.ssd.input])
            },
            frequencies: {
                cpu: cpuMhzs
            },
            pwr: {
            },
            lastUpdate: now
        };

        if (this.lastStats) {
            const prevCpu = this.lastStats.stat[0].split(' ').slice(1).filter(x => x).map(Number);
            const currentCpu = data.stat[0].split(' ').slice(1).filter(x => x).map(Number);

            const prevIdle = prevCpu[3] + prevCpu[4];
            const currentIdle = currentCpu[3] + currentCpu[4];

            const prevTotal = prevCpu.reduce((a, b) => a + b, 0);
            const currentTotal = currentCpu.reduce((a, b) => a + b, 0);

            const idleDiff = currentIdle - prevIdle;
            const totalDiff = currentTotal - prevTotal;

            result.usage.cpu = Math.round((1 - idleDiff / totalDiff) * 100);

            const timeDiff = (now - this.lastStats.lastUpdate) / 1000;

            const prevDiskStorage = this.lastStats.diskstats[0].split(' ').filter(x => x);
            const currentDiskStorage = data.diskstats[0].split(' ').filter(x => x);
            const readBytesStorage = (parseInt(currentDiskStorage[5]) - parseInt(prevDiskStorage[5])) * 512 / timeDiff;
            const writeBytesStorage = (parseInt(currentDiskStorage[9]) - parseInt(prevDiskStorage[9])) * 512 / timeDiff;

            const prevDiskSystem = this.lastStats.diskstats[4].split(' ').filter(x => x);
            const currentDiskSystem = data.diskstats[4].split(' ').filter(x => x);
            const readBytesSystem = (parseInt(currentDiskSystem[5]) - parseInt(prevDiskSystem[5])) * 512 / timeDiff;
            const writeBytesSystem = (parseInt(currentDiskSystem[9]) - parseInt(prevDiskSystem[9])) * 512 / timeDiff;

            result.io.diskRead = Math.round(readBytesStorage + readBytesSystem);
            result.io.diskWrite = Math.round(writeBytesStorage + writeBytesSystem);

            const networkStats = data.netdev.find(line => line.startsWith(`${CONFIG.network.interface}:`));
            const prevNetworkStats = this.lastStats.netdev.find(line => line.startsWith(`${CONFIG.network.interface}:`));

            if (networkStats && prevNetworkStats) {
                const [, rxBytes, , , , , , , , txBytes] = networkStats.split(/\s+/);
                const [, prevRxBytes, , , , , , , , prevTxBytes] = prevNetworkStats.split(/\s+/);

                result.io.networkRx = Math.round((parseInt(rxBytes) - parseInt(prevRxBytes)) / timeDiff);
                result.io.networkTx = Math.round((parseInt(txBytes) - parseInt(prevTxBytes)) / timeDiff);

            }
        }

        this.lastStats = {
            stat: [...data.stat],
            diskstats: [...data.diskstats],
            netdev: [...data.netdev],
            lastUpdate: now
        };

        return result;
    }

    async updateMetrics() {
        const data = await this.collectData();
        this.metrics = this.transformSystemInfo(data);
        return this.metrics;
    }

    getMetrics() {
        return this.metrics;
    }
}
