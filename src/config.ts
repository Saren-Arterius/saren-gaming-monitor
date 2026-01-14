import { execSync } from "child_process";

export const CONFIG = {
    initInfo: {
        SYSTEM_INFO: {
            hostname: execSync("hostname").toString().trim(),
            os: execSync('uname -r').toString().trim(),
            cpu: 'AMD Ryzen 7 6800U',
            case: 'Lenovo Yoga 7 Gen 7',
        },

        GAUGE_LIMITS: {
            temperature: {
                cpu: { min: 30, max: 90 },
            },
            io: {
                diskRead: { max: 1500 * 1024 * 1024 }, // PCIE 3.0 + PCIE 4.0 NVME SSD
                diskWrite: { max: 1500 * 1024 * 1024 },
                networkRx: { max: 125 * 1024 * 1024 }, // 4x1000 Network
                networkTx: { max: 125 * 1024 * 1024 },
                backupNetworkRx: { max: 6 * 1024 * 1024 }, // 42Mbps Network
                backupNetworkTx: { max: 1 * 1024 * 1024 }
            },
            fanSpeed: {
                cpu: { max: 4200 },
                ssd: { max: 4200 }
            }
        },

        MH_FAN: false
    },
    // lm_sensors json output, See `sensors -j`
    sensors: {
        "cpu": {
            "temperature": "k10temp-pci-00c3",
            "tempField": "Tctl",
            "tempInput": "temp1_input"
        },
        "fans": {}
    },
    network: {
        interface: 'wlp1s0',
        backupInterface: 'enp0s20f0u4',
    },
    server: {
        port: 3000,
        corsOrigin: "*",
        corsMethods: ["GET", "POST"]
    },
    commands: {
        sensors: {
            command: 'sensors -j'
        }
    },
    systemFiles: {
        stat: '/proc/stat',
        meminfo: '/proc/meminfo',
        diskstats: '/proc/diskstats',
        netdev: '/proc/net/dev',
        cpuinfo: '/proc/cpuinfo',
        // ib_rcv: '/sys/devices/pci0000:00/0000:00:02.1/0000:03:00.0/0000:04:00.0/0000:05:00.0/infiniband/mlx5_0/ports/1/counters/port_rcv_data',
        // ib_xmit: '/sys/devices/pci0000:00/0000:00:02.1/0000:03:00.0/0000:04:00.0/0000:05:00.0/infiniband/mlx5_0/ports/1/counters/port_xmit_data',
        uptime: '/proc/uptime',
        loadavg: '/proc/loadavg',

    },
    networkStatusAPI: null,
    iotLeases: null,
    disks: {
        "system": {
            "label": "system",
            "name": "System",
            "device": "/dev/disk/by-id/nvme-KBG50ZNT1T02_LS_KIOXIA_622C857PEJP6",
            "mountPoint": "/",
            "tempLimit": {
                "min": 30,
                "max": 70
            },
            "sensor": {
                "temperature": "nvme-pci-0200",
                "tempField": "Composite",
                "tempInput": "temp1_input"
            }
        }
    }
};

console.log(CONFIG.initInfo.SYSTEM_INFO)
