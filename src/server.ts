import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { CONFIG } from './config';
import { SystemMonitor } from './systemMonitor';

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
            
            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
            });
        });
    }

    private setupMonitoring() {
        setInterval(async () => {
            const metrics = await this.systemMonitor.updateMetrics();
            console.log(metrics);
            this.io.emit('metrics', metrics);
        }, 1000);
    }

    start() {
        this.httpServer.listen(CONFIG.server.port, () => {
            console.log(`Server running on http://localhost:${CONFIG.server.port}`);
        });
    }
}
