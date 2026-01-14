export interface LastStats {
    stat: string[];
    diskstats: string[];
    netdev: string[];
    lastUpdate: number;
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
        cpu?: number;
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
