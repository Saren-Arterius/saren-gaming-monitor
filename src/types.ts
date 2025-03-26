export interface LastStats {
    stat: string[];
    diskstats: string[];
    netdev: string[];
    lastUpdate: number;
}

export interface SystemMetrics {
    temperatures: {
        cpu: number;
        gpu?: number;
        ssd: number;
    };
    usage: {
        cpu?: number;
        gpu?: number;
        ram: number;
        vram?: number;
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
        motherboard?: number;
        ssd?: number;
    }
    frequencies: {
        cpu: number[];
        gpuCore?: number;
    };
    pwr: {
        gpu?: number;
    };
    lastUpdate: number;
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
            last1m_percent: number;
            last5m_percent: number;
            last1h_percent: number;
            last24h_percent: number;
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
    last_updated: number;
}
