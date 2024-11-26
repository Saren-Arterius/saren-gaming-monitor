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
                networkRx: { max: 1.25 * 1024 * 1024 * 1024 }, // 10Gbps Network
                networkTx: { max: 1.25 * 1024 * 1024 * 1024 }
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
        interface: 'enp5s0'
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
        cpuinfo: '/proc/cpuinfo'
    },

};

console.log(CONFIG.initInfo.SYSTEM_INFO)
