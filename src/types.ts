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
        ssd2: number;
    };
    usage: {
        cpu: number;
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
        ssd: number;
    };
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
    network_traffic: {
        historical: {
            last12h: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last15m: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last1d: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last1h: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last1m: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last30d: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last3d: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last3h: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last5m: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
            last7d: {
                avg_rx_Bps: number;
                avg_tx_Bps: number;
                cum_rx: number;
                cum_tx: number;
            };
        };
        minute_history: Array<{
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            timestamp: string;
            total_rx_in_minute: number;
            total_tx_in_minute: number;
        }>;
    };
    last_updated: number;
}

export interface NetworkTraffic {
    historical: {
        last12h: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last15m: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last1d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last1h: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last1m: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last30d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last3d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last3h: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last5m: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last7d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
    };
    minute_history: Array<{
        avg_rx_Bps: number;
        avg_tx_Bps: number;
        timestamp: string;
        total_rx_in_minute: number;
        total_tx_in_minute: number;
    }>;
}
export interface NetworkTraffic {
    historical: {
        last12h: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last15m: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last1d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last1h: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last1m: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last30d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last3d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last3h: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last5m: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
        last7d: {
            avg_rx_Bps: number;
            avg_tx_Bps: number;
            cum_rx: number;
            cum_tx: number;
        };
    };
    minute_history: Array<{
        avg_rx_Bps: number;
        avg_tx_Bps: number;
        timestamp: string;
        total_rx_in_minute: number;
        total_tx_in_minute: number;
    }>;
}
