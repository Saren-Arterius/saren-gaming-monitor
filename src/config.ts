import { execSync } from "child_process";

export const CONFIG = {
    initInfo: {
        SYSTEM_INFO: {
            hostname: execSync("hostname").toString().trim(),
            os: execSync('cat /etc/os-release | grep PRETTY_NAME | cut -d\\" -f2').toString().trim(),
            cpu: 'AMD Ryzen 7 9800X3D',
            gpu: 'NVIDIA GeForce RTX 4090',
            case: 'Lian Li A4-H2O',
        },

        GAUGE_LIMITS: {
            temperature: {
                cpu: { min: 30, max: 95 },
                gpu: { min: 30, max: 80 },
                ssd: { min: 30, max: 70 }
            },
            io: {
                diskRead: { max: 3.75 * 1024 * 1024 * 1024 }, // PCIE 3.0 NVME SSD
                diskWrite: { max: 3.75 * 1024 * 1024 * 1024 },
                networkRx: { max: 3 * 1024 * 1024 * 1024 }, // 40Gbps Network - overhead
                networkTx: { max: 3 * 1024 * 1024 * 1024 }
            },
            fanSpeed: {
                cpu: { max: 2200 },
                motherboard: { max: 12000 }
            }
        },

        MH_FAN: true
    },
    // lm_sensors json output, See `sensors -j`
    sensors: {
        cpu: {
            temperature: 'k10temp-pci-00c3',
            tempField: 'Tctl',
            tempInput: 'temp1_input'
        },
        ssd: {
            temperature: 'nvme-pci-0200',
            tempField: 'Composite',
            tempInput: 'temp1_input'
        },
        fans: {
            controller: 'nct6687-isa-0a20',
            cpu: {
                id: 'fan1',
                input: 'fan1_input'
            },
            motherboard: {
                id: 'fan4',
                input: 'fan4_input'
            }
        }
    },
    network: {
        interface: 'enp5s0np0'
    },
    server: {
        port: 3000,
        corsOrigin: "*",
        corsMethods: ["GET", "POST"]
    },


    commands: {
        nvidia: {
            command: 'nvidia-smi',
            params: '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,clocks.current.graphics,power.draw',
            format: '--format=csv,noheader'
        },
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
        ib_rcv: '/sys/devices/pci0000:00/0000:00:02.1/0000:03:00.0/0000:04:00.0/0000:05:00.0/infiniband/mlx5_0/ports/1/counters/port_rcv_data',
        ib_xmit: '/sys/devices/pci0000:00/0000:00:02.1/0000:03:00.0/0000:04:00.0/0000:05:00.0/infiniband/mlx5_0/ports/1/counters/port_xmit_data',
    },

};

console.log(CONFIG.initInfo.SYSTEM_INFO)
