# AI Health Monitoring

## Overview
The server broadcasts the health status of 3 AI services to all connected Socket.IO clients.

## Socket.IO Events

### `aiHealth` (Server → Client)
Emitted every 5 seconds to all connected clients. Also sent immediately when a client connects.

**Payload:**
```typescript
{
    thinking_brain: { healthy: boolean; error?: string };
    speaking_lips: { healthy: boolean; error?: string };
    listening_ears: { healthy: boolean; error?: string };
}
```

**Example:**
```json
{
  "thinking_brain": { "healthy": true },
  "speaking_lips": { "healthy": true },
  "listening_ears": { "healthy": false, "error": "fetch failed" }
}
```

## Frontend Implementation

### Connect and Listen
```javascript
const socket = io();

socket.on('aiHealth', (health) => {
    // health is an object keyed by service name
    console.log(`thinking_brain: ${health.thinking_brain.healthy ? 'OK' : 'DOWN'}`);
    console.log(`speaking_lips: ${health.speaking_lips.healthy ? 'OK' : 'DOWN'}`);
    console.log(`listening_ears: ${health.listening_ears.healthy ? 'OK' : 'DOWN'}`);
});
```

### Update UI
- Display each service with a status indicator (green/red)
- Show error message if `healthy === false` and `error` is present
- UI updates automatically every 5 seconds

## Service Endpoints (Backend)
- **thinking_brain**: `http://localhost:8000/health` → expects HTTP 200
- **speaking_lips**: `http://localhost:8003/health` → expects HTTP 200
- **listening_ears**: `http://localhost:8004/health` → expects JSON `{ status: "ok" }`
