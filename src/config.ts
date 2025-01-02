import { execSync } from "child_process";

export const CONFIG = {
    initInfo: {
        SYSTEM_INFO: {
            hostname: execSync("hostname").toString().trim(),
            os: execSync('cat /etc/os-release | grep PRETTY_NAME | cut -d\\" -f2').toString().trim(),
            cpu: 'Intel® Core™ i9-13900H',
            case: 'Minisforum MS-01',
        },

        GAUGE_LIMITS: {
            temperature: {
                cpu: { min: 30, max: 90 },
                ssd: { min: 30, max: 76 }, // m2
                ssd2: { min: 30, max: 84 } // u2
            },
            io: {
                diskRead: { max: 5000 * 1024 * 1024 }, // PCIE 3.0 + PCIE 4.0 NVME SSD
                diskWrite: { max: 5000 * 1024 * 1024 }, 
                networkRx: { max: 500 * 1024 * 1024 }, // 4x1000 Network
                networkTx: { max: 250 * 1024 * 1024 }
            },
            fanSpeed: {
                cpu: { max: 4800 },
                ssd: { max: 4800 }
            }
        },
    },
    // lm_sensors json output, See `sensors -j`
    sensors: {
        cpu: {
            temperature: 'coretemp-isa-0000',
            tempField: 'Package id 0',
            tempInput: 'temp1_input'
        },
        ssd: {
            temperature: 'nvme-pci-5900',
            tempField: 'Composite',
            tempInput: 'temp1_input'
        },
        ssd2: {
            temperature: 'nvme-pci-0200',
            tempField: 'Composite',
            tempInput: 'temp1_input'
        },
        fans: {
            controller: 'nct6798-isa-0a20',
            ssd: {
                id: 'fan1',
                input: 'fan1_input'
            },
            cpu: {
                id: 'fan2',
                input: 'fan2_input'
            }
        }
    },
    network: {
        interface: 'ext1'
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
        loadavg: '/proc/loadavg'
    },

};

console.log(CONFIG.initInfo.SYSTEM_INFO)
