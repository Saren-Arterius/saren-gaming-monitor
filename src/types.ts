export interface LastStats {
    stat: string[];
    diskstats: string[];
    netdev: string[];
    ib_rcv: string,
    ib_xmit: string,
    lastUpdate: number;
}

export interface SystemMetrics {
    temperatures: {
        cpu: number;
        gpu: number;
        ssd: number;
        ssd2: number;
    };
    usage: {
        cpu?: number;
        gpu?: number;
        ram: number;
        vram?: number;
        ssd: number;
        ssd2: number;
    };
    usageMB: {
        ram: number;
        vram?: number;
    };
    usageGB: {
        ssd: number;
        ssd2: number;
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
    };
    fanSpeed: {
        cpu: number;
        motherboard: number;
        ssd: number;
    };
    frequencies: {
        cpu: number[];
        gpuCore: number;
    };
    pwr: {
        gpu: number;
    };
    system: string;
    uptime: number;
    lastUpdate: number;
}
