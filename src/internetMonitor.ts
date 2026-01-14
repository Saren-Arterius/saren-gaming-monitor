import { NetworkMonitor, NetworkTarget, MonitorData } from './NetworkMonitor';

interface Server extends NetworkTarget {
    hostname: string;
}

interface ServerMonitorData extends Server, MonitorData { }

export class InternetMonitor extends NetworkMonitor<Server, ServerMonitorData> {
    protected prefix = 'internet';
    private servers: Server[] = [
        { id: 'wtako', hostname: 'WTAKO Network', address: 'wtako.net' },
        { id: 'lihkg', hostname: 'LIHKG', address: 'lihkg.com' },
        { id: 'facebook', hostname: 'Facebook', address: 'facebook.com' },
        { id: 'youtube', hostname: 'YouTube', address: 'youtube.com' },
        { id: 'google', hostname: 'Google', address: 'google.com' },
        { id: 'x', hostname: 'X', address: 'x.com' },
        { id: 'reddit', hostname: 'Reddit', address: 'reddit.com' },
        { id: 'wikipedia', hostname: 'Wikipedia', address: 'wikipedia.org' },
        { id: 'steam', hostname: 'Steam', address: 'store.steampowered.com' },
        { id: 'github', hostname: 'GitHub', address: 'github.com' },
    ];

    protected getTargets(): Server[] {
        return this.servers;
    }
}
