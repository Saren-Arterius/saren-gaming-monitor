import { readFile } from 'fs/promises';
import { exec } from 'child_process';
import util from 'node:util';
import { CONFIG } from './config';
import { LastStats, SystemMetrics, NetworkMetrics } from './types';

const execAsync = util.promisify(exec);

const STORAGE_HEALTH_RESULTS_TEMPLATE = {
    status: 0, // 0 = normal, 1 = warning, 2 = critical
    statusText: 'Normal',
    issues: [],
    metrics: {
        smart: {},
        filesystem: {}
    }
};
export class SystemMonitor {
    private lastStats: LastStats | null = null;
    private metrics: SystemMetrics | null = null;
    private networkMetrics: NetworkMetrics | null = null;
    private saneInfo = {
        networkRxTotal: 0,
        networkTxTotal: 0
    }

    private storageInfo = {
        system: {
            paths: ['/dev/nvme0', '/'],
            lastUpdate: 0,
            info: JSON.parse(JSON.stringify(STORAGE_HEALTH_RESULTS_TEMPLATE)),
        },
    };

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

    async updateNetworkMetrics() {
        try {
            const response = await fetch(CONFIG.networkStatusAPI);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.networkMetrics = await response.json() as NetworkMetrics;
        } catch (error) {
            console.error('Failed to fetch network metrics:', error);
            // this.networkMetrics = null;
        }
        return this.networkMetrics;
    }

    getNetworkMetrics() {
        return this.networkMetrics;
    }

    getNetworkMetricsPartial() {
        if (!this.networkMetrics) {
            return null;
        }

        return {
            internet_ports: this.networkMetrics.internet_ports,
            ping_statistics: this.networkMetrics.ping_statistics,
            network_traffic: this.networkMetrics.network_traffic,
            last_updated: this.networkMetrics.last_updated
        };
    }

    async collectData() {
        const files = CONFIG.systemFiles;
        const commands = [
            execAsync(`${CONFIG.commands.nvidia.command} ${CONFIG.commands.nvidia.params} ${CONFIG.commands.nvidia.format}`),
            execAsync(CONFIG.commands.sensors.command),
            execAsync('df -ml / | tail -n 1'),
            execAsync('df -ml /mnt/storage | tail -n 1'),
            execAsync("ss -tuna state established | grep -v '127.0.0.1' | grep -v '::1' | wc -l"),
            execAsync("ip route | grep metric | grep default")
        ];
        const filePromises = Object.values(files).map(f => readFile(f, 'utf8'));

        try {
            const results = await Promise.all([...commands, ...filePromises]);
            const [
                { stdout: gpu },
                { stdout: sensors },
                { stdout: ssdStats },
                { stdout: ssd2Stats },
                { stdout: activeConn },
                { stdout: ipRoute },
                stat,
                meminfo,
                diskstats,
                netdev,
                cpuinfo,
                ib_rcv,
                ib_xmit,
                uptime,
                loadavg
            ] = results;

            return {
                gpu: gpu.split(',').map(str => str.trim()),
                sensors: JSON.parse(sensors),
                ssdStats: ssdStats.split(' ').filter(Boolean),
                ssd2Stats: ssd2Stats.split(' ').filter(Boolean),
                activeConn: activeConn.trim(),
                ipRoute: ipRoute.trim(),
                stat: stat.split('\n'),
                meminfo: meminfo.split('\n'),
                diskstats: diskstats.split('\n'),
                netdev: netdev.split('\n').map(l => l.trim()),
                cpuinfo: cpuinfo.split('\n'),
                ib_rcv: ib_rcv.trim(),
                ib_xmit: ib_xmit.trim(),
                uptime: uptime.trim(),
                loadavg: loadavg.trim()
            };
        } catch (error) {
            console.error('Error collecting system data:', error);
            throw error;
        }
    }

    formatUptime(seconds: number) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        return `${days}d ${hours}h ${minutes}m`;
    }

    transformSystemInfo(data: any) {
        const now = Date.now();

        let total = parseInt(data.meminfo.find((line: string) => line.startsWith('MemTotal:')).split(/\s+/)[1]) / 1024;
        let avail = parseInt(data.meminfo.find((line: string) => line.startsWith('MemAvailable:')).split(/\s+/)[1]) / 1024;
        let memUsed = total - avail;
        let memUsage = memUsed / total;

        let cpuMhzs = data.cpuinfo.filter((l: string) => l.startsWith('cpu MHz')).map((s: string) => parseFloat(s.split(':')[1]));

        const formattedUptime = this.formatUptime(parseFloat(data.uptime));
        const loadavg = data.loadavg
            .split(' ')
            .slice(0, 3)
            .map((num: string) => parseFloat(num).toFixed(2))
            .join(' ');

        let system = `${formattedUptime} | ${loadavg}`;

        const result: SystemMetrics = {
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
                networkTx: 0,
                networkPacketsRx: 0,
                networkPacketsTx: 0,
                networkRxTotal: 0,
                networkTxTotal: 0,
                activeConn: parseInt(data.activeConn),
                backupNetworkPacketsRx: 0,
                backupNetworkPacketsTx: 0,
                backupNetworkRx: 0,
                backupNetworkTx: 0,
                isUsingBackup: false,
                routeMetrics: {},
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
            system,
            uptime: parseFloat(data.uptime),
            lastUpdate: now
        };

        if (this.lastStats) {
            const timeDiff = (now - this.lastStats.lastUpdate) / 1000;

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

            const readBytes = (parseInt(currentDisk[5]) - parseInt(prevDisk[5])) * 512 / timeDiff;
            const writeBytes = (parseInt(currentDisk[9]) - parseInt(prevDisk[9])) * 512 / timeDiff;

            result.io.diskRead = Math.round(readBytes);
            result.io.diskWrite = Math.round(writeBytes);

            const networkStats = data.netdev.find((line: string) => line.startsWith(`${CONFIG.network.interface}:`));
            const prevNetworkStats = this.lastStats.netdev.find((line: string) => line.startsWith(`${CONFIG.network.interface}:`));

            const routeMetrics: { [key: string]: number } = {};
            data.ipRoute.split('\n').reverse().forEach((line: string) => {
                const match = line.match(/dev\s+(\S+).*metric\s+(\d+)/);
                if (match) {
                    routeMetrics[match[1]] = parseInt(match[2]);
                }
            });

            const isUsingBackup = routeMetrics[CONFIG.network.backupInterface] < 1000;
            result.io.isUsingBackup = isUsingBackup;
            result.io.routeMetrics = routeMetrics;

            if (networkStats && prevNetworkStats) {
                const [, rxBytes, rxPackets, , , , , , , txBytes, txPackets] = networkStats.split(/\s+/);
                const [, prevRxBytes, prevRxPackets, , , , , , , prevTxBytes, prevTxPackets] = prevNetworkStats.split(/\s+/);

                let ibRx = Math.round(((parseInt(data.ib_rcv) * 4) - (parseInt(this.lastStats.ib_rcv) * 4)) / timeDiff);
                let ibTx = Math.round(((parseInt(data.ib_xmit) * 4) - (parseInt(this.lastStats.ib_xmit) * 4)) / timeDiff);

                result.io.networkRx = Math.round((parseInt(rxBytes) - parseInt(prevRxBytes)) / timeDiff) + ibRx;
                result.io.networkTx = Math.round((parseInt(txBytes) - parseInt(prevTxBytes)) / timeDiff) + ibTx;

                result.io.networkPacketsRx = Math.round((parseInt(rxPackets) - parseInt(prevRxPackets)) / timeDiff);
                result.io.networkPacketsTx = Math.round((parseInt(txPackets) - parseInt(prevTxPackets)) / timeDiff);


                // Prevent interface restart surprises
                if (parseInt(rxBytes) > this.saneInfo.networkRxTotal) {
                    this.saneInfo.networkRxTotal = parseInt(rxBytes);
                }
                if (parseInt(txBytes) > this.saneInfo.networkTxTotal) {
                    this.saneInfo.networkTxTotal = parseInt(txBytes);
                }
                result.io.networkRxTotal = this.saneInfo.networkRxTotal;
                result.io.networkTxTotal = this.saneInfo.networkTxTotal;
            }

            const backupNetworkStats = data.netdev.find((line: string) => line.startsWith(`${CONFIG.network.backupInterface}:`));
            const backupPrevNetworkStats = this.lastStats.netdev.find((line: string) => line.startsWith(`${CONFIG.network.backupInterface}:`));
            if (backupNetworkStats && backupPrevNetworkStats) {
                const [, rxBytes, rxPackets, , , , , , txBytes, txPackets] = backupNetworkStats.split(/\s+/);
                const [, prevRxBytes, prevRxPackets, , , , , , prevTxBytes, prevTxPackets] = backupPrevNetworkStats.split(/\s+/);

                result.io.backupNetworkRx = Math.round((parseInt(rxBytes) - parseInt(prevRxBytes)) / timeDiff);
                result.io.backupNetworkTx = Math.round((parseInt(txBytes) - parseInt(prevTxBytes)) / timeDiff);

                result.io.backupNetworkPacketsRx = Math.round((parseInt(rxPackets) - parseInt(prevRxPackets)) / timeDiff);
                result.io.backupNetworkPacketsTx = Math.round((parseInt(txPackets) - parseInt(prevTxPackets)) / timeDiff);
            }
        }

        this.lastStats = {
            stat: [...data.stat],
            diskstats: [...data.diskstats],
            netdev: [...data.netdev],
            ib_rcv: data.ib_rcv,
            ib_xmit: data.ib_xmit,
            lastUpdate: now
        };
        return result;
    }

    analyzeStorageHealth(smartData: any, btrfsData: any) {

        let results = JSON.parse(JSON.stringify(STORAGE_HEALTH_RESULTS_TEMPLATE));
        // Helper function to add issues
        const addIssue = (message: string, level: number) => {
            results.issues.push(message);
            results.status = Math.max(results.status, level);
        };

        // === SMART Analysis ===
        const health = smartData.nvme_smart_health_information_log;

        // Critical Warning
        if (health.critical_warning !== 0) {
            addIssue(`Critical warning detected (code: ${health.critical_warning})`, 2);
        }

        // Available Spare
        results.metrics.smart.spare = {
            current: health.available_spare,
            threshold: health.available_spare_threshold,
            formatted: `${health.available_spare}% spare (threshold: ${health.available_spare_threshold}%)`
        };
        if (health.available_spare <= health.available_spare_threshold) {
            addIssue('Available spare blocks below threshold', 2);
        } else if (health.available_spare <= health.available_spare_threshold * 1.5) {
            addIssue('Available spare blocks approaching threshold', 1);
        }

        // Wear Level
        results.metrics.smart.wear = {
            percentage: health.percentage_used,
            formatted: `${health.percentage_used}% worn`
        };
        if (health.percentage_used >= 90) {
            addIssue('Drive severely worn', 2);
        } else if (health.percentage_used >= 80) {
            addIssue('Drive significantly worn', 1);
        }

        // Media Errors
        results.metrics.smart.mediaErrors = {
            count: health.media_errors,
            formatted: `${health.media_errors} media errors`
        };
        if (health.media_errors > 0) {
            addIssue(`${health.media_errors} media errors detected`, 2);
        }

        // SMART Status
        if (!smartData.smart_status.passed) {
            addIssue('SMART overall status: FAILED', 2);
        }

        // Power-on time and read/write statistics
        results.metrics.smart.powerOnTime = {
            hours: smartData.power_on_time.hours,
            formatted: `${Math.floor(smartData.power_on_time.hours / 24)} days, ${smartData.power_on_time.hours % 24} hours`
        };

        results.metrics.smart.dataWritten = {
            units: health.data_units_written,
            formatted: `${(health.data_units_written * 512000 / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB written`
        };

        results.metrics.smart.dataRead = {
            units: health.data_units_read,
            formatted: `${(health.data_units_read * 512000 / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB read`
        };

        // === BTRFS Analysis ===
        const deviceStats = btrfsData["device-stats"][0];

        results.metrics.filesystem = {
            writeErrors: deviceStats.write_io_errs,
            readErrors: deviceStats.read_io_errs,
            flushErrors: deviceStats.flush_io_errs,
            corruptionErrors: deviceStats.corruption_errs,
            generationErrors: deviceStats.generation_errs
        };

        // Check for any BTRFS errors
        if (deviceStats.write_io_errs > 0) {
            addIssue(`${deviceStats.write_io_errs} BTRFS write errors detected`, 2);
        }
        if (deviceStats.read_io_errs > 0) {
            addIssue(`${deviceStats.read_io_errs} BTRFS read errors detected`, 2);
        }
        if (deviceStats.flush_io_errs > 0) {
            addIssue(`${deviceStats.flush_io_errs} BTRFS flush errors detected`, 2);
        }
        if (deviceStats.corruption_errs > 0) {
            addIssue(`${deviceStats.corruption_errs} BTRFS corruption errors detected`, 2);
        }
        if (deviceStats.generation_errs > 0) {
            addIssue(`${deviceStats.generation_errs} BTRFS generation errors detected`, 2);
        }

        // Set status description
        results.statusText = ['Normal', 'Warning', 'Critical'][results.status];

        return results;
    }


    async collectStorageInfo(section: string) {
        let paths = this.storageInfo[section as keyof typeof this.storageInfo].paths;
        const [
            { stdout: smart },
            { stdout: btrfsStats },
        ] = await Promise.all([
            execAsync(`sudo smartctl ${paths[0]} -aj`),
            execAsync(`sudo btrfs --format=json device stats ${paths[1]}`)
        ]);
        return this.analyzeStorageHealth(JSON.parse(smart), JSON.parse(btrfsStats));
    }

    async updateStorageInfo() {
        for (let [section, storage] of Object.entries(this.storageInfo)) {
            let info = await this.collectStorageInfo(section);
            storage.info = info;
            storage.lastUpdate = Date.now();
        }
        return this.storageInfo;
    }

    getStorageInfo() {
        return this.storageInfo;
    }
}
