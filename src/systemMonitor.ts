import { CONFIG } from './config';
import { LastStats, SystemMetrics, SSDMetrics, BtrfsScrubStatus, StorageHealthInfo, StorageInfoMap } from './types';

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

    private smartCache: { [label: string]: any } = {};

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

    async updateMetrics() {
        try {
            const data = await this.collectData();
            this.metrics = this.transformSystemInfo(data);
        } catch (error) {
            console.error('Error updating system metrics:', error);
        }
        return this.metrics;
    }

    getMetrics(): SystemMetrics | null {
        return this.metrics;
    }


    async collectData(): Promise<any> {
        await this.resolveDeviceNames();
        const files = CONFIG.systemFiles;
        const disks = Object.values(CONFIG.disks);
        const dfCommands = disks.map(disk => `df -ml ${disk.mountPoint} | tail -n 1`);

        const commands = [
            `${CONFIG.commands.nvidia.command} ${CONFIG.commands.nvidia.params} ${CONFIG.commands.nvidia.format}`,
            (CONFIG.commands as any).vram.command,
            ...dfCommands,
            "ss -tuna state established | grep -v '127.0.0.1' | grep -v '::1' | wc -l",
            "ip route | grep metric | grep default"
        ];

        const sensorPromise = execAsync(CONFIG.commands.sensors.command);
        const cpupowerPromise = execAsync(CONFIG.commands.cpupower.command);
        const commandPromises = commands.map(cmd => execAsync(cmd));

        // Handle potential arrays in systemFiles
        const fileEntries = Object.entries(files);
        const filePromises: Promise<string | string[]>[] = fileEntries.map(async ([key, value]) => {
            if (Array.isArray(value)) {
                return Promise.all(value.map(f => Bun.file(f).text()));
            }
            return Bun.file(value).text();
        });

        const [sensorResult, cpupowerResult, ...rest] = await Promise.all([
            sensorPromise,
            cpupowerPromise,
            ...commandPromises,
            ...filePromises
        ]);

        const commandResults = rest.slice(0, commands.length) as { stdout: string, stderr: string }[];
        const fileResults = rest.slice(commands.length) as (string | string[])[];

        const gpuResult = commandResults[0];
        const vramResult = commandResults[1];
        const dfResults = commandResults.slice(2, 2 + dfCommands.length).map(r => r.stdout.trim().split(/\s+/));
        const otherCommandResults = commandResults.slice(2 + dfCommands.length);

        const storageStats: { [key: string]: string[] } = {};
        disks.forEach((disk, index) => {
            storageStats[disk.label] = dfResults[index];
        });

        const fileData: { [key: string]: any } = {};
        fileEntries.forEach(([key], index) => {
            fileData[key] = fileResults[index];
        });

        const vramUsed = vramResult.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !isNaN(parseInt(line)))
            .reduce((acc, val) => acc + parseInt(val), 0);

        return {
            gpu: gpuResult.stdout.split(',').map(str => str.trim()),
            vramUsed,
            sensors: JSON.parse(sensorResult.stdout),
            cpupower: cpupowerResult.stdout,
            storageStats,
            activeConn: otherCommandResults[0].stdout.trim(),
            ipRoute: otherCommandResults[1].stdout.trim(),
            stat: (fileData.stat as string).split('\n'),
            meminfo: (fileData.meminfo as string).split('\n'),
            diskstats: (fileData.diskstats as string).split('\n'),
            netdev: (fileData.netdev as string).split('\n').map(l => l.trim()),
            cpuinfo: (fileData.cpuinfo as string).split('\n'),
            ib_rcv: Array.isArray(fileData.ib_rcv) ? fileData.ib_rcv.map((s: string) => s.trim()) : [fileData.ib_rcv.trim()],
            ib_xmit: Array.isArray(fileData.ib_xmit) ? fileData.ib_xmit.map((s: string) => s.trim()) : [fileData.ib_xmit.trim()],
            uptime: (fileData.uptime as string).trim(),
            loadavg: (fileData.loadavg as string).trim()
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

        if (cpuMhzs.length === 0 && data.cpupower) {
            // Fallback to cpupower frequency-info hardware limits
            // Example: "hardware limits: 338 MHz - 2.81 GHz"
            const matches = [...data.cpupower.matchAll(/hardware limits:\s+([\d.]+)\s+(GHz|MHz)\s+-\s+([\d.]+)\s+(GHz|MHz)/g)];
            if (matches.length > 0) {
                cpuMhzs = [];
                matches.forEach(match => {
                    let minFreq = parseFloat(match[1]);
                    if (match[2] === 'GHz') minFreq *= 1000;

                    let maxFreq = parseFloat(match[3]);
                    if (match[4] === 'GHz') maxFreq *= 1000;

                    cpuMhzs.push(minFreq, maxFreq);
                });
            }
        }

        const formattedUptime = this.formatUptime(parseFloat(data.uptime));
        const loadavg = data.loadavg
            .split(' ')
            .slice(0, 3)
            .map((num: string) => parseFloat(num).toFixed(2))
            .join(' ');

        let system = `${formattedUptime} | ${loadavg}`;

        const disksMetrics: { [label: string]: SSDMetrics } = {};
        let totalDiskRead = 0;
        let totalDiskWrite = 0;

        const timeDiff = this.lastStats ? (now - this.lastStats.lastUpdate) / 1000 : 0;

        for (const disk of Object.values(CONFIG.disks) as any[]) {
            const stats = data.storageStats[disk.label];
            // df output split by \s+:
            // 0: device, 1: total, 2: used, 3: avail, 4: use%, 5: mount
            const usage = stats ? parseInt(stats[4].replace('%', '')) : 0;
            const usageGB = stats ? Math.round(parseInt(stats[2]) / 1024) : 0;

            let temperature = -274;
            if (disk.sensor) {
                try {
                    temperature = Math.round(parseFloat(data.sensors[disk.sensor.temperature][disk.sensor.tempField][disk.sensor.tempInput]));
                } catch (e) {
                    // console.error(`Failed to read temperature for ${disk.label}`, e);
                }
            } else {
                const smartData = this.smartCache[disk.label];
                if (smartData && smartData.temperature && typeof smartData.temperature.current === 'number') {
                    temperature = smartData.temperature.current;
                }
            }

            if (temperature === -274) continue; // device not found

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
                gpu: parseFloat(data.gpu[1]),
                cx7: Math.round(parseFloat(data.sensors[CONFIG.sensors.cx7.temperature][CONFIG.sensors.cx7.tempField][CONFIG.sensors.cx7.tempInput])),
            },
            usage: {
                cpu: 0,
                gpu: parseInt(data.gpu[2]),
                ram: Math.round(memUsage * 100),
                vram: Math.round((data.vramUsed / total) * 100)
            },
            usageMB: {
                ram: Math.round(memUsed),
                vram: data.vramUsed
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
            disks: disksMetrics,
            frequencies: {
                cpu: cpuMhzs,
                gpuCore: parseInt(data.gpu[3]),
            },
            pwr: {
                gpu: parseFloat(data.gpu[4]),
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

            const routeMetrics: { [key: string]: number } = {};
            data.ipRoute.split('\n').reverse().forEach((line: string) => {
                const match = line.match(/dev\s+(\S+).*metric\s+(\d+)/);
                if (match) {
                    routeMetrics[match[1]] = parseInt(match[2]);
                }
            });

            result.io.routeMetrics = routeMetrics;
            result.io.isUsingBackup = false; // Default to false as backupInterface was removed

            let totalRx = 0;
            let totalTx = 0;
            let totalPacketsRx = 0;
            let totalPacketsTx = 0;
            let currentRxTotal = 0;
            let currentTxTotal = 0;

            for (const iface of CONFIG.network.interfaces) {
                const networkStats = data.netdev.find((line: string) => line.startsWith(`${iface}:`));
                const prevNetworkStats = this.lastStats.netdev.find((line: string) => line.startsWith(`${iface}:`));

                if (networkStats && prevNetworkStats) {
                    const parts = networkStats.split(/\s+/);
                    const prevParts = prevNetworkStats.split(/\s+/);

                    // /proc/net/dev format:
                    // face |rx_bytes rx_packets rx_errs rx_drop rx_fifo rx_frame rx_compressed rx_multicast|tx_bytes tx_packets tx_errs tx_drop tx_fifo tx_colls tx_carrier tx_compressed
                    // parts[0] is "face:", parts[1] is rx_bytes, parts[2] is rx_packets, parts[9] is tx_bytes, parts[10] is tx_packets
                    const rxBytes = parseInt(parts[1]);
                    const rxPackets = parseInt(parts[2]);
                    const txBytes = parseInt(parts[9]);
                    const txPackets = parseInt(parts[10]);

                    const prevRxBytes = parseInt(prevParts[1]);
                    const prevRxPackets = parseInt(prevParts[2]);
                    const prevTxBytes = parseInt(prevParts[9]);
                    const prevTxPackets = parseInt(prevParts[10]);

                    totalRx += Math.round((rxBytes - prevRxBytes) / timeDiff);
                    totalTx += Math.round((txBytes - prevTxBytes) / timeDiff);
                    totalPacketsRx += Math.round((rxPackets - prevRxPackets) / timeDiff);
                    totalPacketsTx += Math.round((txPackets - prevTxPackets) / timeDiff);

                    currentRxTotal += rxBytes;
                    currentTxTotal += txBytes;
                }
            }

            let ibRx = 0;
            let ibTx = 0;

            for (let i = 0; i < data.ib_rcv.length; i++) {
                if (this.lastStats.ib_rcv[i]) {
                    ibRx += Math.round(((parseInt(data.ib_rcv[i]) * 4) - (parseInt(this.lastStats.ib_rcv[i]) * 4)) / timeDiff);
                }
            }
            for (let i = 0; i < data.ib_xmit.length; i++) {
                if (this.lastStats.ib_xmit[i]) {
                    ibTx += Math.round(((parseInt(data.ib_xmit[i]) * 4) - (parseInt(this.lastStats.ib_xmit[i]) * 4)) / timeDiff);
                }
            }

            result.io.networkRx = totalRx + ibRx;
            result.io.networkTx = totalTx + ibTx;
            result.io.networkPacketsRx = totalPacketsRx;
            result.io.networkPacketsTx = totalPacketsTx;

            // Prevent interface restart surprises
            if (currentRxTotal > this.saneInfo.networkRxTotal) {
                this.saneInfo.networkRxTotal = currentRxTotal;
            }
            if (currentTxTotal > this.saneInfo.networkTxTotal) {
                this.saneInfo.networkTxTotal = currentTxTotal;
            }
            result.io.networkRxTotal = this.saneInfo.networkRxTotal;
            result.io.networkTxTotal = this.saneInfo.networkTxTotal;
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

        if (!smartData || !smartData.smart_status) {
            addIssue('SMART data unavailable', 1);
            return results;
        }

        // === SMART Analysis ===
        const nvmeHealth = smartData.nvme_smart_health_information_log;

        if (nvmeHealth) {
            // NVME specific
            if (nvmeHealth.critical_warning !== 0) {
                addIssue(`Critical warning detected (code: ${nvmeHealth.critical_warning})`, 2);
            }

            results.metrics.smart.spare = {
                current: nvmeHealth.available_spare,
                threshold: nvmeHealth.available_spare_threshold,
                formatted: `${nvmeHealth.available_spare}% spare (threshold: ${nvmeHealth.available_spare_threshold}%)`
            };
            if (nvmeHealth.available_spare <= nvmeHealth.available_spare_threshold) {
                addIssue('Available spare blocks below threshold', 2);
            }

            results.metrics.smart.wear = {
                percentage: nvmeHealth.percentage_used,
                formatted: `${nvmeHealth.percentage_used}% worn`
            };

            results.metrics.smart.mediaErrors = {
                count: nvmeHealth.media_errors,
                formatted: `${nvmeHealth.media_errors} media errors`
            };
            if (nvmeHealth.media_errors > 0) {
                addIssue(`${nvmeHealth.media_errors} media errors detected`, 2);
            }

            results.metrics.smart.dataWritten = {
                units: nvmeHealth.data_units_written,
                formatted: `${(nvmeHealth.data_units_written * 512000 / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB written`
            };

            results.metrics.smart.dataRead = {
                units: nvmeHealth.data_units_read,
                formatted: `${(nvmeHealth.data_units_read * 512000 / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB read`
            };
        } else if (smartData.ata_smart_attributes && smartData.ata_smart_attributes.table) {
            // HDD / ATA specific
            const attrMap = new Map<number, any>();
            for (const attr of smartData.ata_smart_attributes.table) {
                attrMap.set(attr.id, attr);
            }

            // Media Errors: Reallocated + Pending + Uncorrectable
            const reallocated = attrMap.get(5)?.raw.value || 0;
            const pending = attrMap.get(197)?.raw.value || 0;
            const uncorrectable = attrMap.get(198)?.raw.value || 0;
            const totalMediaErrors = reallocated + pending + uncorrectable;

            results.metrics.smart.mediaErrors = {
                count: totalMediaErrors,
                formatted: `${totalMediaErrors} errors (R:${reallocated} P:${pending} U:${uncorrectable})`
            };
            if (totalMediaErrors > 0) {
                addIssue(`${totalMediaErrors} media errors detected (Reallocated: ${reallocated}, Pending: ${pending}, Uncorrectable: ${uncorrectable})`, 2);
            }

            // Spare: Use Reallocated Sector Count as a proxy for "spare used"
            // Most HDDs don't report "available spare" as a percentage like NVMe
            // We'll use the normalized value of Reallocated_Sector_Ct (id 5)
            const reallocatedAttr = attrMap.get(5);
            if (reallocatedAttr) {
                results.metrics.smart.spare = {
                    current: reallocatedAttr.value,
                    threshold: reallocatedAttr.thresh,
                    formatted: `${reallocatedAttr.value}% remaining`
                };
                if (reallocatedAttr.value <= reallocatedAttr.thresh) {
                    addIssue('Reallocated sectors threshold reached', 2);
                }
            }

            // Wear: Helium level for high-capacity drives, or just N/A
            const helium = attrMap.get(22);
            if (helium) {
                results.metrics.smart.wear = {
                    percentage: 100 - helium.value,
                    formatted: `Helium Level: ${helium.value}%`
                };
                if (helium.value < helium.thresh) {
                    addIssue(`Low helium level detected: ${helium.value}%`, 2);
                }
            } else {
                results.metrics.smart.wear = { percentage: 0, formatted: "N/A" };
            }

            // Data Written/Read: Not standard for ATA SMART, but some drives have vendor-specific attributes
            // For the provided HC570, NAND_Master (90) seems to be present but its meaning is unclear.
            // We'll leave these as N/A unless we find specific attributes.
            results.metrics.smart.dataWritten = { units: 0, formatted: "N/A" };
            results.metrics.smart.dataRead = { units: 0, formatted: "N/A" };

            // UDMA CRC Errors
            const crcErrors = attrMap.get(199)?.raw.value || 0;
            if (crcErrors > 0) {
                addIssue(`${crcErrors} UDMA CRC errors detected (check cable)`, 1);
            }
        } else {
            results.metrics.smart.spare = { current: 100, threshold: 0, formatted: "N/A" };
            results.metrics.smart.wear = { percentage: 0, formatted: "N/A" };
            results.metrics.smart.mediaErrors = { count: 0, formatted: "N/A" };
            results.metrics.smart.dataWritten = { units: 0, formatted: "N/A" };
            results.metrics.smart.dataRead = { units: 0, formatted: "N/A" };
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

        // Power-on time
        if (smartData.power_on_time) {
            results.metrics.smart.powerOnTime = {
                hours: smartData.power_on_time.hours,
                formatted: `${Math.floor(smartData.power_on_time.hours / 24)} days, ${smartData.power_on_time.hours % 24} hours`
            };
        } else {
            results.metrics.smart.powerOnTime = { hours: 0, formatted: "N/A" };
        }

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
        let smartJson = null;
        try {
            smartJson = JSON.parse(smart);
            this.smartCache[label] = smartJson;
        } catch (e) { }

        let btrfsJson = null;
        try {
            btrfsJson = JSON.parse(btrfsStats);
        } catch (e) { }

        const health = this.analyzeStorageHealth(smartJson, btrfsJson, scrubStatus);

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
