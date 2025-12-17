# Hardware & IoT Monitoring Server

A TypeScript-based server that provides real-time Linux hardware and IoT device monitoring capabilities through a WebSocket interface. This server collects and broadcasts system metrics including CPU, memory usage, temperatures, fan speeds, storage health, and network statistics, as well as monitoring latency and packet loss for IoT devices on the network.

## Features

- **Real-time System Monitoring**:
  - CPU usage, frequency, and load averages
  - Memory usage (RAM)
  - Disk I/O (Read/Write speeds)
  - Network I/O (Upload/Download speeds, Packet counts)
  - Dual Network Interface support (Primary + Backup/Failover monitoring)

- **Hardware Health**:
  - CPU & SSD Temperatures
  - Fan Speeds
  - Storage Health Monitoring (SMART data & BTRFS device stats)

- **IoT Monitoring**:
  - Auto-discovery of devices via `dnsmasq` leases
  - Real-time Ping statistics (Latency, Jitter, Packet Loss)
  - Historical data aggregation (1m to 24h)

- **Architecture**:
  - WebSocket-based real-time communication
  - Redis-backed time-series data for IoT metrics
  - Lightweight and efficient

## Prerequisites

- **Runtime**: [Bun](https://bun.sh)
- **OS**: Linux-based operating system
- **Database**: Redis Server (Optional, required only for IoT monitoring)
- **System Tools**:
  - `lm-sensors` (for temperature/fan sensors)
  - `smartmontools` (for `smartctl` storage health)
  - `btrfs-progs` (if using BTRFS monitoring)
  - `dnsmasq` (for IoT device discovery via leases file)
  - `iproute2` (for `ip` command)
  - `sysstat` (optional, for general system stats)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Saren-Arterius/saren-gaming-monitor.git
   cd saren-gaming-monitor
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Ensure Redis is running (If using IoT features):
   ```bash
   sudo systemctl start redis
   # OR
   redis-server --daemonize yes
   ```

## Configuration

The server is configured through `src/config.ts`. You **must** update this file to match your hardware configuration.

Key configuration areas:

- **System Info**: Hostname, CPU model, Case model.
- **Gauge Limits**: Min/Max values for UI gauges (Temperatures, I/O speeds).
- **Sensors**:
  - Run `sensors -j` to find your sensor paths.
  - Update `sensors.cpu` with the correct IDs.
  - Update `sensors.fans` to map fans to specific controllers and inputs (e.g., `cpu`, `systemSSD`).
- **Disks**:
  - Configure your SSDs in the `disks` object.
  - Each disk entry requires:
    - `label`: Unique identifier (e.g., `systemSSD`).
    - `name`: Display name.
    - `device`: Path to device (e.g., `/dev/disk/by-id/...`).
    - `mountPoint`: Mount point for usage stats.
    - `tempLimit`: Min/Max temperature for gauges.
    - `sensor`: Temperature sensor configuration (from `sensors -j`).
- **Network**:
  - `interface`: Your primary network interface (e.g., `eth0`, `enp3s0`).
  - `backupInterface`: Secondary interface for failover monitoring.
- **System Files**: Paths to `/proc` files (usually standard, but check `diskstats` or `netdev` if needed).
- **IoT Monitoring**:
  - `iotLeases`: Path to your dnsmasq leases file (default: `/var/lib/misc/dnsmasq.10.leases`). Set to `null` to disable IoT monitoring and remove Redis dependency.

### Configuration Helper Scripts

You can automatically configure your `src/config.ts` file with detected hardware (Disks, CPU, Fans) using the setup script.

**Automatic Setup (Recommended):**
This script detects your hardware and updates `src/config.ts` directly.
```bash
cd src
npm run setup-config
# OR
bun scripts/setup-config.ts
```

**Manual Generation:**
If you prefer to generate the configuration snippets manually:

1.  **Generate Disk Configuration**:
    ```bash
    cd src
    npm run generate-config
    ```

2.  **Generate Sensors Configuration**:
    ```bash
    cd src
    npm run generate-sensors-config
    ```

## Usage

1. Start the server:
   ```bash
   bun start
   ```
   *Note: You may need to run as root (`sudo bun start`) if you want to access SMART data via `smartctl` without configuring sudoers.*

2. The server will start on port `3000` (default).

3. Connect to the WebSocket or HTTP server at:
   - `http://localhost:3000`
   - `http://<YOUR_SERVER_IP>:3000`


## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](LICENSE) file for details.

## Contributing

See the [CONTRIBUTING.md](CONTRIBUTING.md) file for details.
