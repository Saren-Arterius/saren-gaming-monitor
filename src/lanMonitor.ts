const hosts: HostConfig[] = [
  {
    ip: "192.168.0.1",
    type: "snmp",
    community: "read_only_user",
    interfaceKeywords: ["ext1", "int1", "int2", "int3", "enp0s20f0u4"],
  },
  {
    ip: "192.168.0.208",
    type: "snmp",
    community: "public",
    interfaceKeywords: ["ether1", "sfp-sfpplus1", "sfp-sfpplus2", "sfp-sfpplus3", "sfp-sfpplus4"],
  },
  {
    ip: "192.168.0.106",
    type: "http",
    name: "YourSwitch",
  },
];

// ==== Type Definitions ====

export interface HostConfig {
  ip: string;
  type: "snmp" | "http";
  community?: string;
  interfaceKeywords?: string[];
  port?: number;
  name?: string;
}

export interface InterfaceData {
  name: string;
  rx: string;
  tx: string;
}

export interface RateInterfaceData {
  name: string;
  rx_bps: number;
  tx_bps: number;
}

export interface RateHostResult {
  ip: string;
  label?: string;
  interfaces: RateInterfaceData[];
}

export interface SnmpHostResult {
  ip: string;
  community: string;
  interfaces: InterfaceData[];
}

export interface HttpHostResult {
  ip: string;
  name: string;
  interfaces: RateInterfaceData[];
}

export type HostResult = SnmpHostResult | HttpHostResult;

// ==== Constants ====

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Pragma": "no-cache",
  "Cache-Control": "no-cache",
};

const DEFAULT_PASSWORD = Bun.env.DEVICE_PASSWORD ?? "password";

// ==== Type Guards ====

function isSnmpData(data: SnmpData | HttpData[]): data is SnmpData {
  return "indexByName" in data;
}

// ==== Utility Functions ====

function formatBytes(bytes: string): string {
  if (bytes === "N/A") return "N/A";
  const num = BigInt(bytes);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let unitIndex = 0;
  let value = BigInt(num);
  let remainder = BigInt(0);

  while (value >= 1024n && unitIndex < units.length - 1) {
    remainder = value % 1024n;
    value = value / 1024n;
    unitIndex++;
  }

  const decimal = Math.round(Number((remainder * 100n) / 1024n));
  return `${value}.${decimal.toString().padStart(2, "0")} ${units[unitIndex]}`;
}

function formatBps(bps: number): string {
  if (bps === 0) return "0 bps";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let value = bps;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

// ==== Low-Level Implementation ====

async function spawnSnmp(cmd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
    const text = await proc.stdout.text();
    return text;
  } catch {
    return null;
  }
}

async function login(host: HostConfig): Promise<string | null> {
  console.log("login needed");
  try {
    const response = await fetch(`http://${host.ip}/`, {
      headers: DEFAULT_HEADERS,
    });

    const cookies = response.headers.get("set-cookie") || "";
    const match = cookies.match(/SessionID=(\d+)/);
    const session = match ? match[1] : `${Math.floor(Math.random() * 1000000000)}`;

    await fetch(`http://${host.ip}/logon.cgi`, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": `http://${host.ip}`,
        "Referer": `http://${host.ip}/`,
        "Cookie": `SessionID=${session}`,
      },
      body: `username=saren&password=${DEFAULT_PASSWORD}&isIe=false&logon=%E7%99%BB%E5%BD%95`,
    });

    return session;
  } catch {
    return null;
  }
}

// ==== Core Business Logic ====

interface SnmpData {
  indexByName: Map<string, number>;
  rxData: Map<number, string>;
  txData: Map<number, string>;
}

interface HttpData {
  rx_bps: number;
  tx_bps: number;
  name: string;
}

async function pollSnmpOnce(host: HostConfig): Promise<SnmpData | null> {
  try {
    const descOutput = await spawnSnmp(`snmpwalk -v2c -c ${host.community} ${host.ip} IF-MIB::ifName 2>&1`);
    if (!descOutput) return null;

    const indexByName = new Map<string, number>();
    for (const line of descOutput.split("\n")) {
      const match = line.match(/IF-MIB::ifName\.(\d+)\s+=\s+STRING:\s+(.+)/);
      if (match) indexByName.set(match[2].trim(), parseInt(match[1]));
    }

    const rxOutput = await spawnSnmp(`snmpwalk -v2c -c ${host.community} ${host.ip} IF-MIB::ifHCInOctets 2>&1`);
    const rxData = new Map<number, string>();
    if (rxOutput) {
      for (const line of rxOutput.split("\n")) {
        const match = line.match(/IF-MIB::ifHCInOctets\.(\d+)\s+=\s+(?:Counter32|Counter64):\s+(\d+)/);
        if (match) rxData.set(parseInt(match[1]), match[2]);
      }
    }

    const txOutput = await spawnSnmp(`snmpwalk -v2c -c ${host.community} ${host.ip} IF-MIB::ifHCOutOctets 2>&1`);
    const txData = new Map<number, string>();
    if (txOutput) {
      for (const line of txOutput.split("\n")) {
        const match = line.match(/IF-MIB::ifHCOutOctets\.(\d+)\s+=\s+(?:Counter32|Counter64):\s+(\d+)/);
        if (match) txData.set(parseInt(match[1]), match[2]);
      }
    }

    return { indexByName, rxData, txData };
  } catch {
    return null;
  }
}

async function pollHttpOnce(host: HostConfig): Promise<HttpData[] | null> {
  try {
    const portPart = host.port ? `:${host.port}` : "";
    const html = await (await fetch(`http://${host.ip}${portPart}/MainRpm.htm`)).text();
    let rxMatch = html.match(/rx_rate:\[(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\]/);
    let txMatch = html.match(/tx_rate:\[(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\]/);

    if (!rxMatch || !txMatch) {
      const session = await login(host);
      if (!session) return null;

      const headers = new Headers();
      headers.append("Cookie", `SessionID=${session}`);
      const html2 = await (await fetch(`http://${host.ip}${portPart}/MainRpm.htm`, { headers })).text();
      rxMatch = html2.match(/rx_rate:\[(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\]/);
      txMatch = html2.match(/tx_rate:\[(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\]/);
      if (!rxMatch || !txMatch) return null;
    }

    const rxRate = rxMatch.slice(1).map(Number);
    const txRate = txMatch.slice(1).map(Number);
    const nameMatch = html.match(/iface_name:"([^"]+)"/);
    const interfaceNames = nameMatch
      ? nameMatch[1].split(",").map((s) => s.trim())
      : rxRate.length / 2 === 4
        ? ["port1", "port2", "port3", "port4"]
        : ["port1", "port2", "port3", "port4", "port5", "port6", "port7", "port8"];

    return interfaceNames.map((name, i) => ({
      name,
      rx_bps: Math.floor((rxRate[i * 2] + rxRate[i * 2 + 1] / 100) * 1024 * 1024 / 8),
      tx_bps: Math.floor((txRate[i * 2] + txRate[i * 2 + 1] / 100) * 1024 * 1024 / 8),
    }));
  } catch {
    return null;
  }
}

async function monitor(hostConfigs: HostConfig[]): Promise<HostResult[]> {
  const results: HostResult[] = [];

  for (const host of hostConfigs) {
    if (host.type !== "snmp") continue;
    if (!host.interfaceKeywords?.length) continue;

    const data = await pollSnmpOnce(host);
    if (!data) continue;

    const interfaces: InterfaceData[] = [];
    for (const [ifaceName, idx] of data.indexByName) {
      for (const keyword of host.interfaceKeywords) {
        if (ifaceName === keyword || ifaceName.includes(keyword)) {
          interfaces.push({
            name: ifaceName,
            rx: data.rxData.get(idx) || "N/A",
            tx: data.txData.get(idx) || "N/A",
          });
          break;
        }
      }
    }

    results.push({ ip: host.ip, community: host.community!, interfaces });
  }

  return results;
}

let sample1: {
  host: HostConfig;
  data: HttpData[] | SnmpData | null;
}[] | null = null;

async function getRealTimeRate(
  hostConfigs: HostConfig[],
  intervalMs: number = 5000
): Promise<RateHostResult[]> {
  const pollAll = async () => {
    console.log('pollAll');
    return Promise.all(
      hostConfigs.map(async (host) => ({
        host,
        data: host.type === "snmp" ? await pollSnmpOnce(host) : await pollHttpOnce(host),
      }))
    )
  };

  // const 
  if (!sample1) {
    sample1 = await pollAll();
  }
  await new Promise((r) => setTimeout(r, intervalMs));
  const sample2 = await pollAll();

  const results: RateHostResult[] = [];
  const seconds = intervalMs / 1000;

  for (let i = 0; i < hostConfigs.length; i++) {
    const host = hostConfigs[i];
    const s1 = sample1[i].data;
    const s2 = sample2[i].data;
    if (!s1 || !s2) continue;

    const label = host.name || host.community || host.ip;
    const interfaces: RateInterfaceData[] = [];

    if (host.type === "snmp" && isSnmpData(s1) && isSnmpData(s2)) {
      for (const [ifaceName, idx] of s1.indexByName) {
        for (const keyword of host.interfaceKeywords || []) {
          if (ifaceName === keyword || ifaceName.includes(keyword)) {
            const rx1 = BigInt(s1.rxData.get(idx) || "0");
            const rx2 = BigInt(s2.rxData.get(idx) || "0");
            const tx1 = BigInt(s1.txData.get(idx) || "0");
            const tx2 = BigInt(s2.txData.get(idx) || "0");
            const rxDiff = rx2 > rx1 ? rx2 - rx1 : rx1 - rx2;
            const txdiff = tx2 > tx1 ? tx2 - tx1 : tx1 - tx2;
            interfaces.push({
              name: ifaceName,
              rx_bps: Number(rxDiff * 8n / BigInt(seconds)),
              tx_bps: Number(txdiff * 8n / BigInt(seconds)),
            });
            break;
          }
        }
      }
    } else if (host.type === "http") {
      const httpData2 = s2 as HttpData[];
      for (let j = 0; j < httpData2.length; j++) {
        interfaces.push({ name: httpData2[j].name, rx_bps: httpData2[j].rx_bps, tx_bps: httpData2[j].tx_bps });
      }
    }

    results.push({ ip: host.ip, label, interfaces });
  }

  sample1 = sample2;

  return results;
}

// ==== Output Functions ====

function printTable(results: HostResult[]) {
  console.log("SNMP Hosts:");
  console.log("Interface       | RX          | TX          | Host");
  console.log("----------------|-------------|-------------|------------------");

  for (const host of results) {
    if ("community" in host) {
      for (const iface of host.interfaces) {
        console.log(`${iface.name.padEnd(15)} | ${formatBytes(iface.rx).padStart(11)} | ${formatBytes(iface.tx).padStart(11)} | ${host.ip}`);
      }
    }
  }
}

function printRateTable(results: RateHostResult[]) {
  console.log("Real-time Network Rate (bps):");
  console.log("Interface       | RX              | TX              | Host");
  console.log("----------------|-----------------|-----------------|------------------");

  for (const host of results) {
    for (const iface of host.interfaces) {
      console.log(`${iface.name.padEnd(15)} | ${formatBps(iface.rx_bps).padStart(15)} | ${formatBps(iface.tx_bps).padStart(15)} | ${host.label || host.ip}`);
    }
  }
}

export type TransformedRealTimeRate = Record<string, {label?: string, interfaces: Record<string, {rx_bps: number, tx_bps: number}>}>;

export class LanMonitor {

  private cachedData: TransformedRealTimeRate | null = null;

  start(callback: (result: TransformedRealTimeRate) => void) {
    (async () => {
      while (true) {
        let result = await getRealTimeRate(hosts);
        const transformed: TransformedRealTimeRate = {};
        for (const host of result) {
          const {ip, label, interfaces} = host;
          const ifs: Record<string, {rx_bps: number, tx_bps: number}> = {};
          for (const nif of interfaces) {
            const {name, rx_bps, tx_bps} = nif;
            ifs[name] = {rx_bps, tx_bps};
          }
          transformed[ip] = {label, interfaces: ifs};
        }
        this.cachedData = transformed;
        callback(transformed);
      }
    })();
  }

  getCachedData() {
    return this.cachedData;
  }
}

// ==== Entry Point ====

if (import.meta.main) {
  console.log("=== Cumulative Traffic ===");
  const results = await monitor(hosts);
  printTable(results);

  console.log("\n=== Real-time Rate (5s interval) ===");
  const rateResults = await getRealTimeRate(hosts);
  printRateTable(rateResults);

  console.log("\n=== Real-time Rate (5s interval next) ===");
  const rateResults2 = await getRealTimeRate(hosts);
  printRateTable(rateResults2);
}
