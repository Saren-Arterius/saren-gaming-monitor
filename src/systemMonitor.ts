import { CONFIG } from './config';
import { LastStats, NetworkMetrics, SystemMetrics, SSDMetrics, BtrfsScrubStatus, StorageHealthInfo, StorageInfoMap } from './types';

async function execAsync(command: string): Promise<{ stdout: string, stderr: string }> {
    const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    return { stdout, stderr };
}

const STORAGE_HEALTH_RESULTS_TEMPLATE = {
    status: 0, // 0 = normal, 1 = warning, 2 = critical
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

    private fsTypes: { [key: string]: string } = {};
    private deviceNames: { [key: string]: string } = {};

    private storageInfo: StorageInfoMap = Object.values(CONFIG.disks).reduce((acc, disk) => {
        acc[disk.label] = {
            paths: [disk.device, disk.mountPoint],
            lastUpdate: 0,
            info: JSON.parse(JSON.stringify(STORAGE_HEALTH_RESULTS_TEMPLATE))
        };
        return acc;
    }, {} as StorageInfoMap);

    async resolveDeviceNames(): Promise<void> {
        if (Object.keys(this.deviceNames).length > 0) return;

        for (const disk of Object.values(CONFIG.disks)) {
            try {
                const { stdout } = await execAsync(`readlink -f ${disk.device}`);
                const devicePath = stdout.trim();
                const deviceName = devicePath.split('/').pop() || '';
                this.deviceNames[disk.label] = deviceName;
            } catch (e) {
                console.error(`Failed to resolve device name for ${disk.label}`, e);
            }
        }
    }

    async updateMetrics(): Promise<SystemMetrics | null> {
        const data = await this.collectData();
        this.metrics = this.transformSystemInfo(data);
        return this.metrics;
    }

    getMetrics(): SystemMetrics | null {
        return this.metrics;
    }

    async updateNetworkMetrics(): Promise<NetworkMetrics | null> {
        if (!CONFIG.networkStatusAPI) return null;
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

    getNetworkMetrics(): NetworkMetrics | null {
        return this.networkMetrics;
    }

    getNetworkMetricsPartial(includeIPHistory: boolean = false): Partial<NetworkMetrics> | null {
        if (!this.networkMetrics) {
            return null;
        }

        return {
            internet_ports: this.networkMetrics.internet_ports,
            ping_statistics: this.networkMetrics.ping_statistics,
            network_traffic: this.networkMetrics.network_traffic,
            last_updated: this.networkMetrics.last_updated,
            ...(includeIPHistory ? { ip_history: this.networkMetrics.ip_history } : {})
        };
    }

    async collectData(): Promise<any> {
        await this.resolveDeviceNames();
        const files = CONFIG.systemFiles;
        const disks = Object.values(CONFIG.disks);
        const dfCommands = disks.map(disk => `df -ml ${disk.mountPoint} | tail -n 1`);

        const commands = [
            ...dfCommands,
            "ss -tuna state established | grep -v '127.0.0.1' | grep -v '::1' | wc -l",
            "ip route | grep metric | grep default"
        ];

        const sensorPromise = execAsync(CONFIG.commands.sensors.command);
        const commandPromises = commands.map(cmd => execAsync(cmd));
        const filePromises = Object.values(files).map(f => Bun.file(f).text());

        const [sensorResult, ...rest] = await Promise.all([
            sensorPromise,
            ...commandPromises,
            ...filePromises
        ]);

        const commandResults = rest.slice(0, commands.length) as { stdout: string, stderr: string }[];
        const fileResults = rest.slice(commands.length) as string[];

        const dfResults = commandResults.slice(0, dfCommands.length).map(r => r.stdout.trim().split(/\s+/));
        const otherCommandResults = commandResults.slice(dfCommands.length);

        const storageStats: { [key: string]: string[] } = {};
        disks.forEach((disk, index) => {
            storageStats[disk.label] = dfResults[index];
        });

        return {
            sensors: JSON.parse(sensorResult.stdout),
            storageStats,
            activeConn: otherCommandResults[0].stdout.trim(),
            ipRoute: otherCommandResults[1].stdout.trim(),
            stat: fileResults[0].split('\n'),
            meminfo: fileResults[1].split('\n'),
            diskstats: fileResults[2].split('\n'),
            netdev: fileResults[3].split('\n').map(l => l.trim()),
            cpuinfo: fileResults[4].split('\n'),
            uptime: fileResults[5].trim(),
            loadavg: fileResults[6].trim()
        };
    }


    formatUptime(seconds: number): string {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        return `${days}d ${hours}h ${minutes}m`;
    }


    transformSystemInfo(data: any): SystemMetrics {
        const now = Date.now();

        // console.log(data.ssdStats)
        let total = parseFloat(data.meminfo.find((line: string) => line.startsWith('MemTotal:')).split(/\s+/)[1]) / 1024;
        let avail = parseFloat(data.meminfo.find((line: string) => line.startsWith('MemAvailable:')).split(/\s+/)[1]) / 1024;
        let memUsed = total - avail;
        let memUsage = memUsed / total;

        let cpuMhzs = data.cpuinfo.filter((l: string) => l.startsWith('cpu MHz')).map((s: string) => parseFloat(s.split(':')[1]));

        const formattedUptime = this.formatUptime(parseFloat(data.uptime));
        // Read load averages
        // console.log(data.loadavg);
        const loadavg = data.loadavg
            .split(' ')
            .slice(0, 3)
            .map((num: string) => parseFloat(num).toFixed(2))
            .join(' ');

        // Combine the information in required format
        let system = `${formattedUptime} | ${loadavg}`;

        const disksMetrics: { [label: string]: SSDMetrics } = {};
        let totalDiskRead = 0;
        let totalDiskWrite = 0;

        const timeDiff = this.lastStats ? (now - this.lastStats.lastUpdate) / 1000 : 0;

        for (const disk of Object.values(CONFIG.disks)) {
            const stats = data.storageStats[disk.label];
            // df output split by \s+:
            // 0: device, 1: total, 2: used, 3: avail, 4: use%, 5: mount
            const usage = stats ? parseInt(stats[4].replace('%', '')) : 0;
            const usageGB = stats ? Math.round(parseInt(stats[2]) / 1024) : 0;

            let temperature = 0;
            if (disk.sensor) {
                try {
                    temperature = Math.round(parseFloat(data.sensors[disk.sensor.temperature][disk.sensor.tempField][disk.sensor.tempInput]));
                } catch (e) {
                    // console.error(`Failed to read temperature for ${disk.label}`, e);
                }
            }

            let diskRead = 0;
            let diskWrite = 0;

            if (this.lastStats && timeDiff > 0) {
                const deviceName = this.deviceNames[disk.label];
                if (deviceName) {
                    const findDiskStat = (stats: string[]) => stats.find(line => {
                        const parts = line.trim().split(/\s+/);
                        return parts[2] === deviceName;
                    });

                    const prevLine = findDiskStat(this.lastStats.diskstats);
                    const currentLine = findDiskStat(data.diskstats);

                    if (prevLine && currentLine) {
                        const prevParts = prevLine.trim().split(/\s+/);
                        const currentParts = currentLine.trim().split(/\s+/);
                        // Field 5 is read sectors, Field 9 is write sectors
                        const readBytes = (parseInt(currentParts[5]) - parseInt(prevParts[5])) * 512 / timeDiff;
                        const writeBytes = (parseInt(currentParts[9]) - parseInt(prevParts[9])) * 512 / timeDiff;

                        diskRead = Math.round(readBytes);
                        diskWrite = Math.round(writeBytes);
                    }
                }
            }

            totalDiskRead += diskRead;
            totalDiskWrite += diskWrite;

            disksMetrics[disk.label] = {
                label: disk.label,
                name: disk.name,
                temperature,
                temperatureLimit: disk.tempLimit,
                usage,
                usageGB,
                diskRead,
                diskWrite
            };
        }

        const result: SystemMetrics = {
            temperatures: {
                cpu: Math.round(parseFloat(data.sensors[CONFIG.sensors.cpu.temperature][CONFIG.sensors.cpu.tempField][CONFIG.sensors.cpu.tempInput])),
                gpu: undefined,
            },
            usage: {
                cpu: 0,
                gpu: undefined,
                ram: Math.round(memUsage * 100),
                vram: undefined,
            },
            usageMB: {
                ram: Math.round(memUsed),
                vram: undefined,
            },
            io: {
                diskRead: totalDiskRead,
                diskWrite: totalDiskWrite,
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
                cpu: !CONFIG.sensors.fans.cpu ? 0 : parseInt(data.sensors[CONFIG.sensors.fans.cpu.controller][CONFIG.sensors.fans.cpu.id][CONFIG.sensors.fans.cpu.input]),
                ssd: !CONFIG.sensors.fans.systemSSD ? 0 : parseInt(data.sensors[CONFIG.sensors.fans.systemSSD.controller][CONFIG.sensors.fans.systemSSD.id][CONFIG.sensors.fans.systemSSD.input])
            },
            disks: disksMetrics,
            frequencies: {
                cpu: cpuMhzs
            },
            pwr: {
            },
            system,
            uptime: parseFloat(data.uptime),
            lastUpdate: now
        };

        if (this.lastStats) {
            const prevCpu = this.lastStats.stat[0].split(' ').slice(1).filter((x: string) => x).map(Number);
            const currentCpu = data.stat[0].split(' ').slice(1).filter((x: string) => x).map(Number);

            const prevIdle = prevCpu[3] + prevCpu[4];
            const currentIdle = currentCpu[3] + currentCpu[4];

            const prevTotal = prevCpu.reduce((a: number, b: number) => a + b, 0);
            const currentTotal = currentCpu.reduce((a: number, b: number) => a + b, 0);

            const idleDiff = currentIdle - prevIdle;
            const totalDiff = currentTotal - prevTotal;

            result.usage.cpu = Math.round((1 - idleDiff / totalDiff) * 100);

            const networkStats = data.netdev.find((line: string) => line.startsWith(`${CONFIG.network.interface}:`));

            const routeMetrics: { [key: string]: number } = {};
            data.ipRoute.split('\n').reverse().forEach((line: string) => {
                const match = line.match(/dev\s+(\S+).*metric\s+(\d+)/);
                if (match) {
                    routeMetrics[match[1]] = parseInt(match[2]);
                }
            });
            // console.log({routeMetrics});

            // const isUsingBackup = (!routeMetrics[CONFIG.network.interface] && !!routeMetrics[CONFIG.network.backupInterface]) || 
            //     routeMetrics[CONFIG.network.backupInterface] < routeMetrics[CONFIG.network.interface];
            const isUsingBackup = routeMetrics[CONFIG.network.backupInterface] < 1000;
            result.io.isUsingBackup = isUsingBackup;
            result.io.routeMetrics = routeMetrics;

            const prevNetworkStats = this.lastStats.netdev.find((line: string) => line.startsWith(`${CONFIG.network.interface}:`));

            if (networkStats && prevNetworkStats) {
                const [, rxBytes, rxPackets, , , , , , , txBytes, txPackets] = networkStats.split(/\s+/);
                const [, prevRxBytes, prevRxPackets, , , , , , , prevTxBytes, prevTxPackets] = prevNetworkStats.split(/\s+/);

                result.io.networkRx = Math.round((parseInt(rxBytes) - parseInt(prevRxBytes)) / timeDiff);
                result.io.networkTx = Math.round((parseInt(txBytes) - parseInt(prevTxBytes)) / timeDiff);

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
                // console.log(result.io, this.saneInfo);
            }

            const backupNetworkStats = data.netdev.find((line: string) => line.startsWith(`${CONFIG.network.backupInterface}:`));
            const backupPrevNetworkStats = this.lastStats.netdev.find((line: string) => line.startsWith(`${CONFIG.network.backupInterface}:`));
            if (backupNetworkStats && backupPrevNetworkStats) {
                const [, rxBytes, rxPackets, , , , , , , txBytes, txPackets] = backupNetworkStats.split(/\s+/);
                const [, prevRxBytes, prevRxPackets, , , , , , , prevTxBytes, prevTxPackets] = backupPrevNetworkStats.split(/\s+/);

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
            lastUpdate: now
        };

        return result;
    }



    parseBtrfsScrubStatus(stdout: string): BtrfsScrubStatus | null {
        const lines = stdout.split('\n');
        const status: Partial<BtrfsScrubStatus> = {
            status: 'none',
            progress: 0,
            totalToScrub: 0,
            bytesScrubbed: 0
        };

        const getValue = (key: string) => {
            const line = lines.find(l => l.trim().startsWith(key + ':'));
            if (!line) return '';
            const parts = line.split(':');
            return parts.slice(1).join(':').trim();
        };

        status.uuid = getValue('UUID');
        if (!status.uuid) return null;

        const scrubStartedStr = getValue('Scrub started');
        if (scrubStartedStr) {
            status.scrubStarted = new Date(scrubStartedStr).getTime();
        }

        const statusStr = getValue('Status');
        status.status = (statusStr.toLowerCase() || 'none') as any;

        status.duration = getValue('Duration');
        status.timeLeft = getValue('Time left');
        status.eta = getValue('ETA');
        status.rate = getValue('Rate');
        status.errorSummary = getValue('Error summary');

        const totalStr = getValue('Total to scrub');
        if (totalStr) {
            status.totalToScrub = parseFloat(totalStr.replace('GiB', '')) * 1024 * 1024 * 1024;
        }

        const scrubbedLine = lines.find(l => l.includes('Bytes scrubbed'));
        if (scrubbedLine) {
            const match = scrubbedLine.match(/Bytes scrubbed:\s+([\d.]+)GiB\s+\(([\d.]+)%\)/);
            if (match) {
                status.bytesScrubbed = parseFloat(match[1]) * 1024 * 1024 * 1024;
                status.progress = parseFloat(match[2]);
            }
        }

        if (status.status === 'finished') {
            status.progress = 100;
            status.bytesScrubbed = status.totalToScrub;
        }

        return status as BtrfsScrubStatus;
    }

    analyzeStorageHealth(smartData: any, btrfsData: any, scrubStatus: BtrfsScrubStatus | null): StorageHealthInfo {

        let results: StorageHealthInfo = JSON.parse(JSON.stringify(STORAGE_HEALTH_RESULTS_TEMPLATE));
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
        // health.media_errors = 1; // troll
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

        // BTRFS Scrub Status
        if (scrubStatus) {
            results.metrics.scrub = scrubStatus;
            if (scrubStatus.errorSummary && scrubStatus.errorSummary !== 'no errors found') {
                addIssue(`BTRFS Scrub errors: ${scrubStatus.errorSummary}`, 1);
            }
        }

        // Power-on time and read/write statistics
        results.metrics.smart.powerOnTime = {
            hours: smartData.power_on_time.hours,
            formatted: `${Math.floor(smartData.power_on_time.hours / 24)} days, ${smartData.power_on_time.hours % 24} hours`
        };

        results.metrics.smart.dataWritten = {
            units: health.data_units_written,
            formatted: `${(health.data_units_written * 512000 / (1000 ** 4)).toFixed(2)} TB written`
        };

        results.metrics.smart.dataRead = {
            units: health.data_units_read,
            formatted: `${(health.data_units_read * 512000 / (1000 ** 4)).toFixed(2)} TB read`
        };

        // === BTRFS Analysis ===
        if (btrfsData) {
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
        }

        // Set status description
        results.statusText = ['Normal', 'Warning', 'Critical'][results.status];

        return results;
    }


    async collectStorageInfo(label: string): Promise<StorageHealthInfo | null> {
        const disk = (CONFIG.disks as any)[label];
        if (!disk) return null;
        const device = disk.device;
        const mountPoint = disk.mountPoint;

        // Check filesystem type
        if (!this.fsTypes[mountPoint]) {
            const { stdout: fsType } = await execAsync(`findmnt -n -o FSTYPE -T ${mountPoint}`);
            this.fsTypes[mountPoint] = fsType.trim();
        }
        const isBtrfs = this.fsTypes[mountPoint] === 'btrfs';

        let smart: string;
        let btrfsStats = 'null';
        let scrubStdout = '';
        const smartPromise = execAsync(`sudo smartctl ${device} -aj || true`);

        if (isBtrfs) {
            const [
                smartResult,
                btrfsResult,
                scrubResult
            ] = await Promise.all([
                smartPromise,
                execAsync(`sudo btrfs --format=json device stats ${mountPoint}`),
                execAsync(`sudo btrfs scrub status --gbytes ${mountPoint}`),
            ]);
            smart = smartResult.stdout;
            btrfsStats = btrfsResult.stdout;
            scrubStdout = scrubResult.stdout;
        } else {
            const smartResult = await smartPromise;
            smart = smartResult.stdout;
        }

        const scrubStatus = isBtrfs ? this.parseBtrfsScrubStatus(scrubStdout) : null;
        const health = this.analyzeStorageHealth(JSON.parse(smart), JSON.parse(btrfsStats), scrubStatus);

        if (scrubStatus) {
            health.metrics.scrub = scrubStatus;
        }

        return health;
    }

    async updateStorageInfo(): Promise<StorageInfoMap> {
        for (let [label, storage] of Object.entries(this.storageInfo)) {
            let info = await this.collectStorageInfo(label);
            if (info) {
                storage.info = info;
                storage.lastUpdate = Date.now();
            }
        }
        return this.storageInfo;
    }

    getStorageInfo(): StorageInfoMap {
        return this.storageInfo;
    }
}
