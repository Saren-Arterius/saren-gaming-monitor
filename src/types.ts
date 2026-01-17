export interface LastStats {
    stat: string[];
    diskstats: string[];
    netdev: string[];
    lastUpdate: number;
}

export interface BtrfsScrubStatus {
    uuid: string;
    scrubStarted?: number; // timestamp
    status: 'running' | 'finished' | 'aborted' | 'interrupted' | 'none';
    duration: string;
    timeLeft: string;
    eta: string;
    totalToScrub: number; // bytes
    bytesScrubbed: number; // bytes
    rate: string;
    errorSummary: string;
    progress: number; // 0-100
}

export interface SSDMetrics {
    label: string;
    name: string;
    temperature: number;
    temperatureLimit: { min: number; max: number };
    usage: number;
    usageGB: number;
    diskRead: number;
    diskWrite: number;
}

export interface SystemMetrics {
    temperatures: {
        cpu: number;
        gpu?: number;
    };
    usage: {
        cpu: number;
        gpu?: number;
        ram: number;
        vram?: number;
    };
    usageMB: {
        ram: number;
        vram?: number;
    };
    io: {
        diskRead: number;
        diskWrite: number;
        networkRx: number;
        networkTx: number;
        networkPacketsRx: number;
        networkPacketsTx: number;
        networkRxTotal: number;
        networkTxTotal: number;
        activeConn: number;
        backupNetworkPacketsRx: number;
        backupNetworkPacketsTx: number;
        backupNetworkRx: number;
        backupNetworkTx: number;
        isUsingBackup: boolean;
        routeMetrics: { [key: string]: number };
    };
    fanSpeed: {
        cpu: number;
        ssd: number;
    };
    disks: { [label: string]: SSDMetrics };
    frequencies: {
        cpu: number[];
        gpuCore?: number;
    };
    pwr: {
        gpu?: number;
    };
    system: string;
    uptime: number;
    lastUpdate: number;
}

export interface TrafficStats {
    avg_rx_Bps: number;
    avg_tx_Bps: number;
    cum_rx: number;
    cum_tx: number;
}

export interface NetworkTraffic {
    historical: {
        last12h: TrafficStats;
        last15m: TrafficStats;
        last1d: TrafficStats;
        last1h: TrafficStats;
        last1m: TrafficStats;
        last30d: TrafficStats;
        last3d: TrafficStats;
        last3h: TrafficStats;
        last5m: TrafficStats;
        last7d: TrafficStats;
    };
    minute_history: Array<{
        avg_rx_Bps: number;
        avg_tx_Bps: number;
        timestamp: string;
        total_rx_in_minute: number;
        total_tx_in_minute: number;
    }>;
}

export interface NetworkMetrics {
    ip_history: Array<{
        ip: string;
        timestamp: string;
    }>;
    internet_ports: string[];
    tailscale_ports: string[];
    ping_statistics: {
        latency: {
            latest: number;
            last1m: number;
            last5m: number;
            last1h: number;
            last24h: number;
        };
        packet_loss: {
            latest_percent: number;
            last1m: number;
            last5m: number;
            last1h: number;
            last24h: number;
        };
        outages: Array<{
            start: string;
            end: string;
            duration_seconds: number;
        }>;
        minute_history: Array<{
            timestamp: string;
            latency_ms: number | null;
            packet_loss_percent: number;
        }>;
    };
    network_traffic: NetworkTraffic;
    last_updated: number;
}

export interface StorageHealthInfo {
    status: number;
    statusText?: string;
    issues: string[];
    metrics: {
        smart: {
            spare?: { current: number; threshold: number; formatted: string };
            wear?: { percentage: number; formatted: string };
            mediaErrors?: { count: number; formatted: string };
            powerOnTime?: { hours: number; formatted: string };
            dataWritten?: { units: number; formatted: string };
            dataRead?: { units: number; formatted: string };
        };
        filesystem: {
            writeErrors: number;
            readErrors: number;
            flushErrors: number;
            corruptionErrors: number;
            generationErrors: number;
        };
        scrub?: BtrfsScrubStatus;
    };
}

export interface StorageInfoMap {
    [label: string]: {
        paths: string[];
        lastUpdate: number;
        info: StorageHealthInfo;
    };
}
