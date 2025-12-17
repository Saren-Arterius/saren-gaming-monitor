#!/usr/bin/env bun
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- Interfaces ---

interface BlockDevice {
    name: string;
    mountpoint: string | null;
    model: string | null;
    serial: string | null;
    tran: string | null;
    path: string;
    children?: BlockDevice[];
}

interface LsblkOutput {
    blockdevices: BlockDevice[];
}

interface SensorData {
    [key: string]: {
        [key: string]: {
            [key: string]: number;
        } | string;
    };
}

// --- Helpers ---

function execute(command: string): string {
    try {
        return execSync(command).toString();
    } catch (error) {
        console.error(`Error executing command: ${command}`, error);
        return '';
    }
}

function getDiskById(deviceName: string): string | null {
    const byIdDir = '/dev/disk/by-id';
    if (!fs.existsSync(byIdDir)) return null;

    const files = fs.readdirSync(byIdDir);
    const targetDevice = deviceName.split('/').pop()!;
    
    const candidates = files.filter(f => {
        try {
            const linkPath = fs.readlinkSync(path.join(byIdDir, f));
            const resolved = path.basename(linkPath);
            return resolved === targetDevice && 
                   !f.startsWith('wwn-') && 
                   !f.startsWith('nvme-eui');
        } catch (e) {
            return false;
        }
    });
    
    const best = candidates.find(f => f.startsWith('nvme-') || f.startsWith('ata-')) || candidates[0];
    return best ? path.join(byIdDir, best) : null;
}

function getNvmePciAddress(deviceName: string): string | null {
    try {
        const sysBlockPath = `/sys/block/${deviceName}/device`;
        if (!fs.existsSync(sysBlockPath)) return null;
        
        const nvmeControllerPath = fs.readlinkSync(sysBlockPath);
        const nvmeControllerName = path.basename(nvmeControllerPath);
        
        const sysClassNvmePath = `/sys/class/nvme/${nvmeControllerName}`;
        if (!fs.existsSync(sysClassNvmePath)) return null;
        
        const pciPath = fs.readlinkSync(sysClassNvmePath);
        const matches = pciPath.match(/(\d{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])/g);
        return matches ? matches[matches.length - 1] : null;
    } catch (e) {
        return null;
    }
}

function formatPciAddressForSensor(pciAddress: string): string {
    const parts = pciAddress.split(':');
    if (parts.length < 3) return '';
    const bus = parts[1];
    const device = parts[2].split('.')[0];
    return `${bus}${device}`;
}

// --- Generators ---

function generateDisksConfig(lsblk: LsblkOutput, sensors: SensorData): any {
    const disksConfig: any = {};

    function processDevice(device: BlockDevice) {
        if (device.tran === 'nvme' || device.tran === 'sata' || device.tran === 'usb') {
             // Process
        } else {
            return;
        }

        const deviceName = path.basename(device.path);
        const byIdPath = getDiskById(deviceName);
        
        let sensorInfo = null;
        
        if (device.tran === 'nvme') {
            const pciAddress = getNvmePciAddress(deviceName);
            if (pciAddress) {
                const sensorIdSuffix = formatPciAddressForSensor(pciAddress);
                const sensorName = `nvme-pci-${sensorIdSuffix}`;
                
                if (sensors[sensorName]) {
                    const compositeKey = Object.keys(sensors[sensorName]).find(k => k === 'Composite');
                    if (compositeKey) {
                        sensorInfo = {
                            temperature: sensorName,
                            tempField: 'Composite',
                            tempInput: 'temp1_input'
                        };
                    }
                }
            }
        }
        
        let mountPoint = device.mountpoint;
        if (!mountPoint && device.children) {
            const collectMounts = (devs: BlockDevice[]): string[] => {
                let mounts: string[] = [];
                for (const d of devs) {
                    if (d.mountpoint) mounts.push(d.mountpoint);
                    if (d.children) {
                        mounts = mounts.concat(collectMounts(d.children));
                    }
                }
                return mounts;
            };
            
            const allMounts = collectMounts(device.children);
            if (allMounts.includes('/')) {
                mountPoint = '/';
            } else {
                mountPoint = allMounts.find(m => m.startsWith('/mnt')) || allMounts[0];
            }
        }

        const label = device.model ? device.model.replace(/\s+/g, '_') : deviceName;
        const configKey = label.replace(/[^a-zA-Z0-9]/g, '');

        disksConfig[configKey] = {
            label: configKey,
            name: device.model || deviceName,
            device: byIdPath || device.path,
            mountPoint: mountPoint || '',
            tempLimit: { min: 30, max: 70 },
            sensor: sensorInfo
        };
    }

    lsblk.blockdevices.forEach(processDevice);
    return disksConfig;
}

function generateSensorsConfig(sensors: SensorData): any {
    const config: any = {
        cpu: null,
        fans: {}
    };

    // CPU
    for (const [sensorName, data] of Object.entries(sensors)) {
        if (sensorName.startsWith('coretemp-')) {
            const packageKey = Object.keys(data).find(k => k.startsWith('Package id'));
            if (packageKey) {
                config.cpu = {
                    temperature: sensorName,
                    tempField: packageKey,
                    tempInput: 'temp1_input'
                };
                break;
            }
        } else if (sensorName.startsWith('k10temp-')) {
            const tctlKey = Object.keys(data).find(k => k === 'Tctl' || k === 'Tdie');
            if (tctlKey) {
                config.cpu = {
                    temperature: sensorName,
                    tempField: tctlKey,
                    tempInput: 'temp1_input'
                };
                break;
            }
        }
    }

    // Fans
    for (const [sensorName, data] of Object.entries(sensors)) {
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'object' && value !== null) {
                const fanInputKey = Object.keys(value).find(k => k.startsWith('fan') && k.endsWith('_input'));
                if (fanInputKey) {
                    const fanId = key;
                    const fanLabel = `fan_${sensorName}_${fanId}`;
                    
                    config.fans[fanLabel] = {
                        controller: sensorName,
                        id: fanId,
                        input: fanInputKey
                    };
                }
            }
        }
    }

    return config;
}

// --- Main ---

function replaceBlock(content: string, key: string, newObject: any): string {
    const regex = new RegExp(`${key}\\s*:\\s*\\{`);
    const match = content.match(regex);
    
    if (!match) {
        console.error(`Could not find block for key: ${key}`);
        return content;
    }

    const startIndex = match.index! + match[0].length - 1; // Index of '{'
    let braceCount = 1;
    let endIndex = -1;

    for (let i = startIndex + 1; i < content.length; i++) {
        if (content[i] === '{') braceCount++;
        else if (content[i] === '}') braceCount--;

        if (braceCount === 0) {
            endIndex = i + 1; // Include '}'
            break;
        }
    }

    if (endIndex === -1) {
        console.error(`Could not find closing brace for key: ${key}`);
        return content;
    }

    const newContent = JSON.stringify(newObject, null, 4);
    // Indent the new content to match the file style (4 spaces)
    // But JSON.stringify already adds indentation. We just need to align the block.
    // The file seems to use 4 spaces.
    // We can just replace the block.
    
    // However, JSON.stringify keys are quoted. We might want to unquote them for style, but it's not strictly necessary.
    
    return content.substring(0, match.index) + `${key}: ${newContent}` + content.substring(endIndex);
}

function main() {
    console.log('Gathering system info...');
    const lsblkOutput = execute('lsblk -J -o NAME,MOUNTPOINT,MODEL,SERIAL,TRAN,PATH');
    const sensorsOutput = execute('sensors -j');
    
    if (!lsblkOutput || !sensorsOutput) {
        console.error('Failed to get system info');
        return;
    }

    const lsblk: LsblkOutput = JSON.parse(lsblkOutput);
    const sensors: SensorData = JSON.parse(sensorsOutput);

    console.log('Generating configuration...');
    const disksData = generateDisksConfig(lsblk, sensors);
    const sensorsData = generateSensorsConfig(sensors);

    const configTemplatePath = path.join(path.dirname(new URL(import.meta.url).pathname), '../config.ts.template');
    if (!fs.existsSync(configTemplatePath)) {
        console.error(`Config file not found at ${configTemplatePath}`);
        return;
    }

    let configContent = fs.readFileSync(configTemplatePath, 'utf-8');

    console.log('Updating config.ts...');
    configContent = replaceBlock(configContent, 'sensors', sensorsData);
    configContent = replaceBlock(configContent, 'disks', disksData);

    const configPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../config.ts');
    fs.writeFileSync(configPath, configContent);
    console.log('Done! src/config.ts has been updated.');
}

main();
