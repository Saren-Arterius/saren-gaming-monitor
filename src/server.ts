import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { CONFIG } from './config';
import { SystemMonitor } from './systemMonitor';
import { NetworkMetrics } from './types';

export class AppServer {
    private app = express();
    private httpServer = createServer(this.app);
    private io = new Server(this.httpServer, {
        cors: {
            origin: CONFIG.server.corsOrigin,
            methods: CONFIG.server.corsMethods
        }
    });
    private systemMonitor = new SystemMonitor();

    constructor() {
        this.setupExpress();
        this.setupSocketIO();
        this.setupMonitoring();
        this.setupApiRoutes();
    }

    private setupExpress() {
        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
    }

    private setupSocketIO() {
        this.io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);
            socket.emit('initInfo', CONFIG.initInfo);
            socket.emit('metrics', this.systemMonitor.getMetrics());
            socket.emit('storageInfo', { storageInfo: this.systemMonitor.getStorageInfo() });
            socket.emit('networkMetrics', { networkMetrics: this.systemMonitor.getNetworkMetricsPartial() });

            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
            });
        });
    }
    private setupMonitoring() {
        (async () => {
            const metrics = await this.systemMonitor.updateMetrics();
            const networkMetrics = await this.systemMonitor.updateNetworkMetrics();
            const storageInfo = await this.systemMonitor.updateStorageInfo();
            console.log(metrics);
            console.log(networkMetrics);
            console.log(JSON.stringify(storageInfo, null, 2));
        })();

        setInterval(async () => {
            const metrics = await this.systemMonitor.updateMetrics();
            this.io.emit('metrics', metrics);
        }, 1000);
        setInterval(async () => {
            await this.systemMonitor.updateNetworkMetrics();
            this.io.emit('networkMetrics', { networkMetrics: this.systemMonitor.getNetworkMetricsPartial() });
        }, 5000);
        setInterval(async () => {
            const storageInfo = await this.systemMonitor.updateStorageInfo();
            console.log(storageInfo);
            this.io.emit('storageInfo', { storageInfo });
        }, 60000);
    }

    private setupApiRoutes() {
        this.app.get('/network-total', async (req, res) => {
            try {
                const metrics = this.systemMonitor.getMetrics();
                res.json({
                    networkRxTotal: metrics?.io.networkRxTotal,
                    networkTxTotal: metrics?.io.networkTxTotal,
                    uptime: metrics?.uptime
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch system metrics' });
            }
        });

        this.app.get('/current', (req, res) => {
            try {
                const metrics = this.systemMonitor.getMetrics();
                const storageInfo = this.systemMonitor.getStorageInfo();
                const networkMetrics = JSON.parse(JSON.stringify(this.systemMonitor.getNetworkMetrics()))
                if (req.query.secret != process.env.SECRET) {
                    delete networkMetrics.ip_history;
                }
                res.json({
                    info: CONFIG.initInfo,
                    metrics,
                    networkMetrics,
                    storageInfo
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch system metrics' });
            }
        });
    }

    start() {
        this.httpServer.listen(CONFIG.server.port, () => {
            console.log(`Server running on http://localhost:${CONFIG.server.port}`);
        });
    }
}
