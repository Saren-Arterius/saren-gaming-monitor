import { Server } from 'socket.io';
import { Server as Engine } from "@socket.io/bun-engine";
import path from 'path';
import { CONFIG } from './config';
import { SystemMonitor } from './systemMonitor';
import { VLLMMonitor } from './vllmMonitor';
import { AIGlobalHealth } from './aiHealth';

export class AppServer {
    private io;
    private systemMonitor = new SystemMonitor();
    private vllmMonitor = new VLLMMonitor();
    private aiHealth = new AIGlobalHealth();
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

        if (pathname === '/current') {
            try {
                const metrics = this.systemMonitor.getMetrics();
                const storageInfo = this.systemMonitor.getStorageInfo();
                const aiHealth = this.aiHealth.getHealth();
                return Response.json({
                    info: CONFIG.initInfo,
                    metrics,
                    storageInfo,
                    aiHealth
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
            socket.emit('vllmMetrics', this.vllmMonitor.getMetrics());
            socket.emit('aiHealth', { aiHealth: this.aiHealth.getHealth() });

            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
            });
        });
    }

    private setupMonitoring() {
        (async () => {
            const metrics = await this.systemMonitor.updateMetrics();
            const storageInfo = await this.systemMonitor.updateStorageInfo();
            const vllmMetrics = await this.vllmMonitor.updateMetrics();
            const aiHealth = await this.aiHealth.updateHealth();
            console.log(metrics);
            console.log(JSON.stringify(storageInfo, null, 2));
            console.log(vllmMetrics);
            console.log(aiHealth);
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
        }, 5000);
        setInterval(async () => {
            const vllmMetrics = await this.vllmMonitor.updateMetrics();
            this.io.emit('vllmMetrics', { vllmMetrics });
        }, 1000);
        setInterval(async () => {
            await this.aiHealth.updateHealth();
            this.io.emit('aiHealth', { aiHealth: this.aiHealth.getHealth() });
        }, 5000);
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
