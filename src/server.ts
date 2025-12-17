import { Server } from 'socket.io';
import { Server as Engine } from "@socket.io/bun-engine";
import path from 'path';
import { CONFIG } from './config';
import { SystemMonitor } from './systemMonitor';
import { IOTMonitor } from './iotMonitor';

export class AppServer {
    private io;
    private systemMonitor = new SystemMonitor();
    private iotMonitor = new IOTMonitor();
    private engine: Engine;

    constructor() {
        this.io = new Server({
            cors: {
                origin: CONFIG.server.corsOrigin,
                methods: CONFIG.server.corsMethods
            }
        });

        this.engine = new Engine({
            path: "/socket.io/",
        });
        this.io.bind(this.engine);

        this.setupSocketIO();
        this.setupMonitoring();
    }

    private async handleRequest(req: Request) {
        const url = new URL(req.url);
        const pathname = url.pathname;

        // API Routes
        if (pathname === '/network-total') {
            try {
                const metrics = this.systemMonitor.getMetrics();
                return Response.json({
                    networkRxTotal: metrics?.io.networkRxTotal,
                    networkTxTotal: metrics?.io.networkTxTotal,
                    uptime: metrics?.uptime
                });
            } catch (error) {
                return Response.json({ error: 'Failed to fetch system metrics' }, { status: 500 });
            }
        }

        if (pathname === '/current') {
            try {
                const metrics = this.systemMonitor.getMetrics();
                const storageInfo = this.systemMonitor.getStorageInfo();
                const networkMetrics = JSON.parse(JSON.stringify(this.systemMonitor.getNetworkMetrics() || {}));
                if (url.searchParams.get('secret') != process.env.SECRET) {
                    delete networkMetrics.ip_history;
                }
                return Response.json({
                    info: CONFIG.initInfo,
                    metrics,
                    networkMetrics,
                    storageInfo,
                    iotMetrics: this.iotMonitor.getCachedData()
                });
            } catch (error) {
                return Response.json({ error: 'Failed to fetch system metrics' }, { status: 500 });
            }
        }

        // Static Files
        let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
        const file = Bun.file(filePath);
        if (await file.exists()) {
            return new Response(file);
        } else {
            return new Response('Not Found', { status: 404 });
        }
    }

    private setupSocketIO() {
        this.io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);
            socket.emit('initInfo', CONFIG.initInfo);
            socket.emit('metrics', this.systemMonitor.getMetrics());
            socket.emit('storageInfo', { storageInfo: this.systemMonitor.getStorageInfo() });
            socket.emit('networkMetrics', {
                networkMetrics: this.systemMonitor.getNetworkMetricsPartial(),
                iotMetrics: this.iotMonitor.getCachedData()
            });

            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
            });
        });
    }

    private setupMonitoring() {
        this.iotMonitor.start();

        (async () => {
            const metrics = await this.systemMonitor.updateMetrics();
            const storageInfo = await this.systemMonitor.updateStorageInfo();
            console.log(metrics);
            console.log(JSON.stringify(storageInfo, null, 2));
            while (true) {
                try {
                    await this.systemMonitor.updateNetworkMetrics();
                    this.io.emit('networkMetrics', {
                        networkMetrics: this.systemMonitor.getNetworkMetricsPartial(),
                        iotMetrics: this.iotMonitor.getCachedData()
                    });
                } catch (e) {
                    console.error(e);
                }
                await new Promise(resolve => setTimeout(resolve, 2500));
            }
        })();

        setInterval(async () => {
            const metrics = await this.systemMonitor.updateMetrics();
            // console.log(metrics);
            this.io.emit('metrics', metrics);
        }, 1000);
        setInterval(async () => {
            const storageInfo = await this.systemMonitor.updateStorageInfo();
            console.log(storageInfo);
            this.io.emit('storageInfo', { storageInfo });
        }, 60000);
    }

    start() {
        const engineHandler = this.engine.handler();
        Bun.serve({
            port: CONFIG.server.port,
            fetch: async (req, server) => {
                const url = new URL(req.url);
                if (url.pathname.startsWith("/socket.io/")) {
                    return engineHandler.fetch(req, server);
                }
                return this.handleRequest(req);
            },
            websocket: engineHandler.websocket
        });
        console.log(`Server running on http://localhost:${CONFIG.server.port}`);
    }
}
