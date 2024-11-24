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
        try {
            const nvidiaCmdStr = `${CONFIG.commands.nvidia.command} ${CONFIG.commands.nvidia.params} ${CONFIG.commands.nvidia.format}`;
            const [
                { stdout: gpu },
                { stdout: sensors },
                stat,
                meminfo,
                diskstats,
                netdev,
                cpuinfo
            ] = await Promise.all([
                execAsync(nvidiaCmdStr),
                execAsync(CONFIG.commands.sensors.command),
                readFile(CONFIG.systemFiles.stat).then(b => b.toString()),
                readFile(CONFIG.systemFiles.meminfo).then(b => b.toString()),
                readFile(CONFIG.systemFiles.diskstats).then(b => b.toString()),
                readFile(CONFIG.systemFiles.netdev).then(b => b.toString()),
                readFile(CONFIG.systemFiles.cpuinfo).then(b => b.toString())
            ]);

            return {
                gpu: gpu.split(',').map(str => str.trim()),
                sensors: JSON.parse(sensors),
                stat: stat.split('\n'),
                meminfo: meminfo.split('\n'),
                diskstats: diskstats.split('\n'),
                netdev: netdev.split('\n'),
                cpuinfo: cpuinfo.split('\n')
            };
        } catch (error) {
            console.error('Error collecting system data:', error);
            throw error;
        }
    }

    transformSystemInfo(data) {
        const now = Date.now();

        let total = data.meminfo.find(line => line.startsWith('MemTotal:')).split(/\s+/)[1] / 1024;
        let avail = data.meminfo.find(line => line.startsWith('MemAvailable:')).split(/\s+/)[1] / 1024;
        let memUsed = total - avail;
        let memUsage = memUsed / total;

        let cpuMhzs = data.cpuinfo.filter(l => l.startsWith('cpu MHz')).map(s => parseFloat(s.split(':')[1]));

        const result = {
            temperatures: {
                cpu: Math.round(parseFloat(data.sensors[CONFIG.sensors.cpu.temperature][CONFIG.sensors.cpu.tempField][CONFIG.sensors.cpu.tempInput])),
                gpu: parseFloat(data.gpu[1]),
                ssd: Math.round(parseFloat(data.sensors[CONFIG.sensors.ssd.temperature][CONFIG.sensors.ssd.tempField][CONFIG.sensors.ssd.tempInput]))
            },
            usage: {
                cpu: 0,
                gpu: parseInt(data.gpu[2]),
                ram: Math.round(memUsage * 100),
                vram: Math.round(parseInt(data.gpu[3]) / parseInt(data.gpu[4]) * 100)
            },
            usageMB: {
                ram: Math.round(memUsed),
                vram: parseInt(data.gpu[3])
            },
            io: {
                diskRead: 0,
                diskWrite: 0,
                networkRx: 0,
                networkTx: 0
            },
            fanSpeed: {
                cpu: parseInt(data.sensors[CONFIG.sensors.fans.controller][CONFIG.sensors.fans.cpu.id][CONFIG.sensors.fans.cpu.input]),
                motherboard: parseInt(data.sensors[CONFIG.sensors.fans.controller][CONFIG.sensors.fans.motherboard.id][CONFIG.sensors.fans.motherboard.input])
            },
            frequencies: {
                cpu: cpuMhzs,
                gpuCore: parseInt(data.gpu[5]),
            },
            pwr: {
                gpu: parseFloat(data.gpu[6]),
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

            const prevDisk = this.lastStats.diskstats[0].split(' ').filter(x => x);
            const currentDisk = data.diskstats[0].split(' ').filter(x => x);
            const timeDiff = (now - this.lastStats.lastUpdate) / 1000;

            const readBytes = (parseInt(currentDisk[5]) - parseInt(prevDisk[5])) * 512 / timeDiff;
            const writeBytes = (parseInt(currentDisk[9]) - parseInt(prevDisk[9])) * 512 / timeDiff;

            result.io.diskRead = Math.round(readBytes);
            result.io.diskWrite = Math.round(writeBytes);

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
        try {
            const data = await this.collectData();
            this.metrics = this.transformSystemInfo(data);
        } catch (error) {
            console.error('Error updating system metrics:', error);
        }
        return this.metrics;
    }

    getMetrics() {
        return this.metrics;
    }
    
}
