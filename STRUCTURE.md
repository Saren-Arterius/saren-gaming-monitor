## WebSocket Events

### Server → Client

- `initInfo`: Initial system information and configuration
- `metrics`: Real-time system metrics (sent every second)

### Client → Server

- `connection`: Established when a client connects
- `disconnect`: Triggered when a client disconnects

## Data Structure

### Metrics Format
```typescript
interface SystemMetrics {
    temperatures: {
        cpu: number;
        gpu: number;
        ssd: number;
    };
    usage: {
        cpu: number;
        gpu: number;
        ram: number;
        vram: number;
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
        motherboard: number;
    };
    frequencies: {
        cpu: number[];
        gpuCore: number;
    };
    pwr: {
        gpu: number;
    };
    lastUpdate: number;
}
```

## Dependencies

- express
- socket.io
- node:util
- child_process
- fs/promises