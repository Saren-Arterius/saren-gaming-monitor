import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import util from 'node:util';

import { exec } from "child_process";
import { readFile } from "fs/promises";

const execAsync = util.promisify(exec);


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html by default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let lastStats = null; // Global variable to store previous stats
let metrics = null;

// Socket.IO connection handling
io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    socket.on('message', (data: any) => {
        console.log('Message received:', data);
        io.emit('metrics', metrics);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

function transformSystemInfo(data) {
    const now = Date.now();

    let total = data.meminfo.find(line => line.startsWith('MemTotal:')).split(/\s+/)[1] / 1024;
    let avail = data.meminfo.find(line => line.startsWith('MemAvailable:')).split(/\s+/)[1] / 1024;
    let memUsed = total - avail;
    let memUsage = memUsed / total;

    let cpuMhzs = data.cpuinfo.filter(l => l.startsWith('cpu MHz')).map(s => parseFloat(s.split(':')[1]));
    console.log(cpuMhzs)
    const result = {
        temperatures: {
            cpu: Math.round(parseFloat(data.sensors['k10temp-pci-00c3'].Tctl.temp1_input)),
            gpu: parseFloat(data.gpu[1]),
            ssd: Math.round(parseFloat(data.sensors['nvme-pci-0200'].Composite.temp1_input))
        },
        usage: {
            gpu: parseInt(data.gpu[2]),
            ram: Math.round(memUsage * 100),
            vram: Math.round(parseInt(data.gpu[3]) / parseInt(data.gpu[4]) * 100)
        },
        usageMB: {
            ram: Math.round(memUsed),
            vram: parseInt(data.gpu[3])
        },
        io: {
            diskRead: 0,
            diskWrite: 0,
            networkRx: 0,
            networkTx: 0
        },
        fanSpeed: {
            cpu: parseInt(data.sensors['nct6687-isa-0a20'].fan1.fan1_input),
            motherboard: parseInt(data.sensors['nct6687-isa-0a20'].fan4.fan4_input)
        },
        frequencies: {
            cpu: cpuMhzs,
            gpuCore: parseInt(data.gpu[5]),
        },
        pwr: {
            gpu: parseFloat(data.gpu[6]),
        },
        lastUpdate: now
    };

    // Calculate CPU usage if we have previous stats
    if (lastStats) {
        const prevCpu = lastStats.stat[0].split(' ').slice(1).filter(x => x).map(Number);
        const currentCpu = data.stat[0].split(' ').slice(1).filter(x => x).map(Number);

        const prevIdle = prevCpu[3] + prevCpu[4];
        const currentIdle = currentCpu[3] + currentCpu[4];

        const prevTotal = prevCpu.reduce((a, b) => a + b, 0);
        const currentTotal = currentCpu.reduce((a, b) => a + b, 0);

        const idleDiff = currentIdle - prevIdle;
        const totalDiff = currentTotal - prevTotal;

        // console.log({idleDiff, totalDiff, currentTotal, prevTotal});
        result.usage.cpu = Math.round((1 - idleDiff / totalDiff) * 100);

        // Calculate disk I/O
        const prevDisk = lastStats.diskstats[0].split(' ').filter(x => x);
        const currentDisk = data.diskstats[0].split(' ').filter(x => x);
        const timeDiff = (now - lastStats.lastUpdate) / 1000; // seconds

        // sectors are 512 bytes
        const readBytes = (parseInt(currentDisk[5]) - parseInt(prevDisk[5])) * 512 / timeDiff;
        const writeBytes = (parseInt(currentDisk[9]) - parseInt(prevDisk[9])) * 512 / timeDiff;

        result.io.diskRead = Math.round(readBytes);
        result.io.diskWrite = Math.round(writeBytes);

        // Calculate network I/O
        const networkStats = data.netdev.find(line => line.startsWith('enp5s0:'));
        const prevNetworkStats = lastStats.netdev.find(line => line.startsWith('enp5s0:'));

        if (networkStats && prevNetworkStats) {
            const [, rxBytes, , , , , , , , txBytes] = networkStats.split(/\s+/);
            const [, prevRxBytes, , , , , , , , prevTxBytes] = prevNetworkStats.split(/\s+/);

            result.io.networkRx = Math.round((rxBytes - prevRxBytes) / timeDiff);
            result.io.networkTx = Math.round((txBytes - prevTxBytes) / timeDiff);
        }
    }

    // Store current stats for next diff
    lastStats = {
        stat: [...data.stat],
        diskstats: [...data.diskstats],
        netdev: [...data.netdev],
        lastUpdate: now
    };

    return result;
}


setInterval(async () => {
    let { stdout: gpu } = await execAsync('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,clocks.current.graphics,power.draw --format=csv,noheader');
    let { stdout: sensors } = await execAsync('sensors -j');
    let stat = (await readFile('/proc/stat')).toString();
    let meminfo = (await readFile('/proc/meminfo')).toString();
    let diskstats = (await readFile('/proc/diskstats')).toString();
    let netdev = (await readFile('/proc/net/dev')).toString();
    let cpuinfo = (await readFile('/proc/cpuinfo')).toString();

    let data = {
        gpu: gpu.split(',').map(str => str.trim()),
        sensors: JSON.parse(sensors),
        stat: stat.split('\n'),
        meminfo: meminfo.split('\n'),
        diskstats: diskstats.split('\n'),
        netdev: netdev.split('\n'),
        cpuinfo: cpuinfo.split('\n')
    };
    // console.log(JSON.stringify(data, null, 2))
    let metrics = transformSystemInfo(data);
    console.log(metrics);
    io.emit('metrics', metrics);
}, 1000);

const PORT = 3000;

httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});