# Hardware Monitoring Server

A TypeScript-based server that provides simple real-time Linux hardware monitoring capabilities through a WebSocket interface. This server collects and broadcasts system metrics including CPU, GPU, memory usage, temperatures, fan speeds, and I/O statistics.

## Features

- Simple real-time hardware monitoring
- WebSocket-based communication
- Support for:
  - CPU metrics (temperature, usage, frequency)
  - GPU metrics (NVIDIA) (temperature, usage, VRAM, power draw)
  - Memory usage
  - Storage I/O
  - Network I/O
  - Fan speeds
  - System information

## Prerequisites

- Node.js, pnpm, npm, npx
- Linux-based operating system
- NVIDIA GPU with nvidia-smi utility installed
- lm-sensors package installed

## Installation

1. Clone the repository
2. Install dependencies:
```bash
pnpm i
```

## Configuration

The server can be configured through the `CONFIG` object in `src/config.ts`. Key configuration options include:

- Server port and CORS settings
- Sensor IDs and paths
- Network interface
- System file paths
- Hardware-specific limits and thresholds
- System information

## Usage

1. Start the server:
```bash
npm start
```

2. Connect to the HTTP server at `http://localhost:3000` OR `http://<YOUR LAN IP>:3000` from remote devices

## Structure
See the [STRUCTURE.md](STRUCTURE.md) file for details.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](LICENSE) file for details.

The AGPL-3.0 ensures that:
- The source code must be made available when the software is distributed
- Modifications must be released under the same license
- Changes must be documented
- Network use counts as distribution

## Contributing
See the [CONTRIBUTING.md](CONTRIBUTING.md) file for details.
