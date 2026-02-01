import { execSync } from "child_process";

export const CONFIG = {
    initInfo: {
        SYSTEM_INFO: {
            hostname: execSync("hostname").toString().trim(),
            os: execSync('cat /etc/os-release | grep PRETTY_NAME | cut -d\\" -f2').toString().trim(),
            cpu: 'NVIDIA GB10',
            gpu: '',
            case: 'MSI EdgeXpert MS-C931',
        },

        GAUGE_LIMITS: {
            temperature: {
                cpu: { min: 30, max: 95 },
                gpu: { min: 30, max: 95 },
                ssd: { min: 30, max: 70 },
                cx7: { min: 30, max: 105 }
            },
            io: {
                diskRead: { max: 7.5 * 1024 * 1024 * 1024 }, // PCIE 4.0 NVME SSD
                diskWrite: { max: 7.5 * 1024 * 1024 * 1024 },
                networkRx: { max: 12.5 * 1024 * 1024 * 1024 },
                networkTx: { max: 12.5 * 1024 * 1024 * 1024 },
            },
        },
    },
    // lm_sensors json output, See `sensors -j`
    sensors: {
        cpu: {
            temperature: 'acpitz-acpi-0',
            tempField: 'temp1',
            tempInput: 'temp1_input'
        },
        cx7: {
            temperature: 'mlx5-pci-0101',
            tempField: 'asic',
            tempInput: 'temp1_input'
        },
        fans: {

        }
    },
    network: {
        interfaces: [
            'enp1s0f0np0',
            'enP7s7',
            'enp1s0f1np1',
            'enP2p1s0f0np0',
            'enP2p1s0f1np1',
            'wlP9s9'
        ],
    },
    server: {
        port: 3000,
        corsOrigin: "*",
        corsMethods: ["GET", "POST"]
    },
    commands: {
        nvidia: {
            command: 'nvidia-smi',
            params: '--query-gpu=name,temperature.gpu,utilization.gpu,clocks.current.graphics,power.draw',
            format: '--format=csv,noheader'
        },
        vram: {
            command: 'nvidia-smi --query-compute-apps used_memory --format=csv,noheader,nounits'
        },
        sensors: {
            command: 'sensors -j'
        },
        cpupower: {
            command: 'cpupower frequency-info'
        }
    },
    systemFiles: {
        stat: '/proc/stat',
        meminfo: '/proc/meminfo',
        diskstats: '/proc/diskstats',
        netdev: '/proc/net/dev',
        cpuinfo: '/proc/cpuinfo',
        ib_rcv: [
            '/sys/devices/pci0000:00/0000:00:00.0/0000:01:00.0/infiniband/rocep1s0f0/ports/1/counters/port_rcv_data',
            '/sys/devices/pci0000:00/0000:00:00.0/0000:01:00.1/infiniband/rocep1s0f1/ports/1/counters/port_rcv_data',
            '/sys/devices/pci0002:00/0002:00:00.0/0002:01:00.0/infiniband/roceP2p1s0f0/ports/1/counters/port_rcv_data',
            '/sys/devices/pci0002:00/0002:00:00.0/0002:01:00.1/infiniband/roceP2p1s0f1/ports/1/counters/port_rcv_data'
        ],
        ib_xmit: [
            '/sys/devices/pci0000:00/0000:00:00.0/0000:01:00.0/infiniband/rocep1s0f0/ports/1/counters/port_xmit_data',
            '/sys/devices/pci0000:00/0000:00:00.0/0000:01:00.1/infiniband/rocep1s0f1/ports/1/counters/port_xmit_data',
            '/sys/devices/pci0002:00/0002:00:00.0/0002:01:00.0/infiniband/roceP2p1s0f0/ports/1/counters/port_xmit_data',
            '/sys/devices/pci0002:00/0002:00:00.0/0002:01:00.1/infiniband/roceP2p1s0f1/ports/1/counters/port_xmit_data'
        ],
        uptime: '/proc/uptime',
        loadavg: '/proc/loadavg'
    },
    disks: {
        systemSSD: {
            label: 'systemSSD',
            name: 'System',
            "device": "/dev/disk/by-id/nvme-ESL01TBTLCZ-27J2-TYN_5P1250703005000105_1",
            "mountPoint": "/",
            "tempLimit": {
                "min": 30,
                "max": 70
            },
            "sensor": {
                "temperature": "nvme-pci-40100",
                "tempField": "Composite",
                "tempInput": "temp1_input"
            }
        }
    }
};

console.log(CONFIG.initInfo.SYSTEM_INFO)
