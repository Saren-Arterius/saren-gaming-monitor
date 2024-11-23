export interface LastStats {
    stat: string[];
    diskstats: string[];
    netdev: string[];
    lastUpdate: number;
}

export interface SystemMetrics {
    temperatures: {
        cpu: number;
        gpu: number;
        ssd: number;
    };
    usage: {
        cpu?: number;
        gpu: number;
        ram: number;
        vram: number;
    };
    usageMB: {
        ram: number;
        vram: number;
    };
    io: {
        diskRead: number;
        diskWrite: number;
        networkRx: number;
        networkTx: number;
    };
    fanSpeed: {
        cpu: number;
        motherboard: number;
    };
    frequencies: {
        cpu: number[];
        gpuCore: number;
    };
    pwr: {
        gpu: number;
    };
    lastUpdate: number;
}
