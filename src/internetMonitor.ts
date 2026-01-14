import { NetworkMonitor, NetworkTarget, MonitorData } from './NetworkMonitor';

interface Server extends NetworkTarget {
    hostname: string;
}

interface ServerMonitorData extends Server, MonitorData {}

export class InternetMonitor extends NetworkMonitor<Server, ServerMonitorData> {
    protected prefix = 'internet';
    private servers: Server[] = [
        { id: 'facebook', hostname: 'Facebook', address: 'facebook.com' },
        { id: 'x', hostname: 'X', address: 'x.com' },
        { id: 'google', hostname: 'Google', address: 'google.com' },
        { id: 'steam', hostname: 'Steam', address: 'store.steampowered.com' }
    ];

    protected getTargets(): Server[] {
        return this.servers;
    }
}
