import { CONFIG } from './config';
import { NetworkMonitor, NetworkTarget, MonitorData } from './NetworkMonitor';

interface Device extends NetworkTarget {
    mac: string;
    ip: string;
    hostname: string;
}

interface DeviceMonitorData extends Device, MonitorData {}

export class IOTMonitor extends NetworkMonitor<Device, DeviceMonitorData> {
    protected prefix = 'iot';
    private devices: Map<string, Device> = new Map();

    async start() {
        if (!CONFIG.iotLeases) return;
        await this.refreshLeases();
        // Refresh leases every minute
        setInterval(() => this.refreshLeases(), 60000);
        await super.start();
    }

    protected getTargets(): Device[] {
        return Array.from(this.devices.values());
    }

    private async refreshLeases() {
        try {
            if (!CONFIG.iotLeases) return;
            const file = Bun.file(CONFIG.iotLeases);
            const content = await file.text();
            const lines = content.trim().split('\n');

            const foundDevices = new Map<string, Device>();

            for (const line of lines) {
                // dnsmasq lease format: timestamps mac ip hostname clientid
                const parts = line.split(/\s+/);
                if (parts.length >= 4) {
                    const mac = parts[1];
                    const ip = parts[2];
                    const hostname = parts[3];
                    foundDevices.set(mac, { id: mac, address: ip, mac, ip, hostname });
                }
            }
            this.devices = foundDevices;
        } catch (e) {
            console.error("IOTMonitor: Error reading leases", e);
        }
    }
}
