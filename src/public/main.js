const SMALL_WIDTH = 540;
const SMALL_HEIGHT = 420;
const POWERSAVE_MS = 30000;
const RELAX_BUFFER_MS = 995;
const WAKE_WORD_SPEECH_TIMEOUT = 3000;
const HA_URL = location.hostname.includes('direct2') ? 'https://ha-direct2.wtako.net' : 'https://ha-direct.wtako.net';
const ASSETS_HOST = location.hostname.includes('direct2') ? 'https://monitor-direct2.wtako.net' : 'https://monitor-direct.wtako.net';
const BASE = ASSETS_HOST; // Alias for assets host

const EXIT_MAGIC = 'XXEXITXX';
const REFRESH_MAGIC = 'XXREFRESHXX';
const VOLUME_MAGIC = 'XXVOLUMEXX';

const NIGHT_H = 22;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NIGHT_VOL_EXPONENT = 1;
let DAY_VOL = parseFloat(localStorage.getItem('day_volume') || '1');
let NIGHT_VOL = parseFloat(localStorage.getItem('night_volume') || '1');

const COLOR_STOPS = [
    { color: '#70CAD1', position: 0 },
    { color: '#F7EE7F', position: 50 },
    { color: '#A63D40', position: 100 }
];
const STATE = {
    INITIALIZING: 0,
    IDLE: 1,
    WAKE_WORD_TRIGGERED: 2, // Waiting for VAD speech start/end or timeout
    SENDING_AUDIO: 3,       // VAD onSpeechEnd called, sending to HA, waiting for HA response
    PLAYING_TTS: 4,
};

const STORAGE_TEXT_COLOR = [null, COLOR_STOPS[1].color, COLOR_STOPS[2].color];
const STORAGE_EXTRA_TEXT = [null, ' ⚠️', ' ⛔️'];

const { useEffect } = React;
const { makeAutoObservable } = mobx;
const { Observer, observer } = mobxReactLite;
// const { Circle, Cpu, Activity } = require('react-feather');

class Store {
    // Configuration Constants
    SYSTEM_INFO = {
        hostname: 'PC',
        cpu: 'AMD',
        gpu: 'Nvidia',
        case: 'PC Case',
        os: 'Linux'
    };

    GAUGE_LIMITS = {
        temperature: {
            cpu: { min: 30, max: 95 },
            gpu: { min: 30, max: 80 },
            ssd: { min: 30, max: 70 }
        },
        io: {
            diskRead: { max: 3.75 * 1024 * 1024 * 1024 },
            diskWrite: { max: 3.75 * 1024 * 1024 * 1024 },
            networkRx: { max: 1.25 * 1024 * 1024 * 1024 },
            networkTx: { max: 1.25 * 1024 * 1024 * 1024 },
            backupNetworkRx: { max: 6 * 1024 * 1024 }, // 42Mbps Network
            backupNetworkTx: { max: 1 * 1024 * 1024 }
        },
        fanSpeed: {
            cpu: { max: 2200 },
            motherboard: { max: 12000 }
        }
    };

    MH_FAN = true;

    alertMessage = null;
    alertExpire = 0;
    windowWidth = window.innerWidth;
    windowHeight = window.innerHeight;

    storageInfo = {}
    temperatures = {
        cpu: 30,
        gpu: 50,
        ssd: 14
    };
    usage = {
        cpu: 34,
        gpu: 50,
        ram: 35,
        vram: 35,
    };
    usageMB = {
        ram: 16384,
        vram: 10240,
    };
    io = {
        diskRead: 10000,
        diskWrite: 10000,
        networkRx: 1000054300,
        networkTx: 1000054300,
        networkPacketsRx: 0,
        networkPacketsTx: 0,

        networkRxTotal: 0,
        networkTxTotal: 0,
        activeConn: 0,

        backupNetworkPacketsRx: 0,
        backupNetworkPacketsTx: 0,
        backupNetworkRx: 0,
        backupNetworkTx: 0,
        isUsingBackup: false,
        routeMetrics: {},
    };
    fanSpeed = {
        cpu: 1500,
        motherboard: 2100
    };
    frequencies = {
        cpu: [0],
        gpuCore: 0,
    };
    pwr = {
        gpu: 0,
    };

    firstDataPushedAt = 0;
    lastDataPushedAt = 0;

    lastUpdate = 0; // server's timestamp
    _uiPollingTimestamp = 0;
    voiceLastActiveAt = 0;
    lastPanelActive = Date.now();
    powerSaveAnimState = 1; // force opacity 

    vaState = STATE.INITIALIZING;
    isUserSpeaking = false;
    lastSTT = '';
    lastSTTAnimState = 0; // 1 = fading out, 2 = changing pos, 0 = fading in or stable;
    lastTTSLength = 0;
    lastTTS = '';
    lastTTSAnimState = 0; // 1 = fading out, 2 = changing pos, 0 = fading in or stable;
    latestText = 0; // 0 = lastSTT, 1 = lastTTS

    vadState = '';
    mainUI = null;
    _lastInteract = Date.now();

    set vaState(value) {
        this._vaState = value;
        this.lastInteract = Date.now(); // Update lastInteract when vaState changes
    }

    get vaState() {
        return this._vaState;
    }

    set uiPollingTimestamp(value) {
        this._uiPollingTimestamp = value;
        this.updateBrightness();
    }

    get uiPollingTimestamp() {
        return this._uiPollingTimestamp;
    }

    set lastInteract(value) {
        this._lastInteract = value;
        this.updateBrightness();
    }

    get lastInteract() {
        return this._lastInteract;
    }

    get mainUIBrightness() {
        console.log('get mainUIBrightness');
        let mainUIBrightness = 1;
        const now = new Date(this.uiPollingTimestamp);
        const currentHour = now.getHours();
        if (currentHour >= NIGHT_H || currentHour < 6) { // Only dim mainUI between 10 PM and 6 AM
            const timeSinceLastInteract = (now.getTime() - this.lastInteract) / 1000; // in seconds
            if (timeSinceLastInteract <= 30) {
                mainUIBrightness = 1;
            } else if (timeSinceLastInteract > 30 && timeSinceLastInteract <= 90) {
                // Linearly interpolate from 1 to 0.3 as timeSinceLastInteract goes from 30 to 90 seconds
                // (timeSinceLastInteract - 30) / (90 - 30) gives a value from 0 to 1
                // 1 - (value * 0.7) means 1 when value is 0, and 0.3 when value is 1
                mainUIBrightness = 1 - (((timeSinceLastInteract - 30) / 60) * 0.7);
            } else {
                mainUIBrightness = 0.3; // Stays at 0.3 after 90 seconds of inactivity
            }
            console.log({ timeSinceLastInteract, mainUIBrightness })
        } else {
            mainUIBrightness = 1; // Do not dim if current hour is not between 10 PM and 6 AM
        }
        return Math.max(0, Math.min(1, mainUIBrightness));
    }

    updateBrightness() {
        if (!this.mainUI) return;
        console.log('updateBrightness');
        if (this.mainUI) {
            this.mainUI.style.filter = `brightness(${this.mainUIBrightness})`;
        }
    }

    constructor() {
        makeAutoObservable(this);
    }
}

const store = new Store();

function getColorAtPercent(percent) {
    let start = COLOR_STOPS[0];
    let end = COLOR_STOPS[1];

    for (let i = 1; i < COLOR_STOPS.length; i++) {
        if (percent <= COLOR_STOPS[i].position) {
            start = COLOR_STOPS[i - 1];
            end = COLOR_STOPS[i];
            break;
        }
    }

    const range = end.position - start.position;
    const adjustedPercent = (percent - start.position) / range;

    const startRGB = hexToRGB(start.color);
    const endRGB = hexToRGB(end.color);

    const r = Math.round(startRGB.r + (endRGB.r - startRGB.r) * adjustedPercent);
    const g = Math.round(startRGB.g + (endRGB.g - startRGB.g) * adjustedPercent);
    const b = Math.round(startRGB.b + (endRGB.b - startRGB.b) * adjustedPercent);

    return rgbToHex(r, g, b);
}

// Helper function to convert hex to RGB
function hexToRGB(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

// Helper function to convert RGB to hex
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

function formatBytes(bytes, decimals = 1, name = 'B', space = true) {
    if (bytes === 0) return `0 ${name}`;

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const formattedValue = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    const unit = sizes[i];

    if (space) {
        return `${formattedValue} ${unit}${name}`;
    } else {
        return `${formattedValue}${unit}${name}`;
    }
}


function getGMT8Time(t) {
    const now = new Date(t);
    // Add GMT+8 offset
    now.setHours(now.getHours());

    // Format components
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    // Combine in desired format
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const Gauge = ({ value, valueMB, valueGB, min = 0, max, label, className, featherName, small, cpuFreq, gpuFreq, gpuPwr, clickFn, textColor, textExtra, labelExtra }) => {
    useEffect(() => {
        // Runs only on mount (empty dependency array)
        feather.replace();
    }, []);

    let pct = ((value - min) / (max - min)) * 75;
    if (pct > 75) pct = 75;
    let iconColor = getColorAtPercent(pct / 0.75);
    let valueExtra = {
        'usage': '%',
        'usage': '%',
        'temperature': '°C',
    }[className] || '';
    if (className === 'io') {
        value = formatBytes(value) + '/s';
    }
    let gaugeSize = small ? 120 : undefined;
    let featherTop = small ? 40 : undefined;
    let featherSize = undefined;
    let gaugeValueMT = undefined;
    let ioTransformLabelMarginTop = undefined;
    let ioTransform = 'scale(0.8)';
    let isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;
    if (isSmallScreen) {
        gaugeSize = small ? 60 : 80;
        featherTop = small ? 20 : 30;
        featherSize = small ? 20 : 24;
        gaugeValueMT = small ? 45 : 60;
        ioTransformLabelMarginTop = -10;
        ioTransform = 'scale(0.5)';
    }
    let labelExtras = (valueMB ? `${valueMB} MB` : '') +
        (valueGB ? `${valueGB} GB` : '') +
        (cpuFreq ? `${Math.round(Math.min(...store.frequencies.cpu))}-${Math.round(Math.max(...store.frequencies.cpu))} MHz` : '') +
        (gpuFreq ? `${store.frequencies.gpuCore} MHz` : '') +
        (gpuPwr ? `${store.pwr.gpu} W` : '') +
        (labelExtra || '');
    return (
        <div className="gauge"
            style={{
                width: gaugeSize,
                height: gaugeSize,
                cursor: clickFn ? 'pointer' : undefined,
                transform: clickFn ? 'scale(1)' : undefined,
                transition: clickFn ? 'transform 0.2s ease-in-out, filter 0.2s ease-in-out' : undefined
            }}
            onMouseEnter={window.matchMedia("(hover: hover) and (pointer: fine)").matches && clickFn ? (e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.filter = 'brightness(1.2)'; } : undefined}
            onMouseLeave={window.matchMedia("(hover: hover) and (pointer: fine)").matches && clickFn ? (e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'brightness(1)'; } : undefined}
            onTouchStart={clickFn ? (e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.filter = 'brightness(1.2)'; } : undefined}
            onTouchEnd={clickFn ? (e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'brightness(1)'; } : undefined}
            onClick={() => {
                clickFn && clickFn();
            }}>
            <div className="gauge-body">
                <div>
                    <div className="gauge-fill"></div>
                    <div className="gauge-cover"></div>
                    <div className="gauge-cover-2" style={{ "--a": `${pct}%` }}></div>
                    <div className="gauge-cover-outer">
                        <div className="feather-wrapper" style={{ "color": `${iconColor}`, top: featherTop }}>
                            <i data-feather={featherName} style={{ width: featherSize, height: featherSize }}></i>
                        </div>
                        <div className="gauge-value" style={{
                            transform: className === 'io' ? ioTransform : undefined,
                            marginTop: gaugeValueMT,
                            color: textColor || undefined
                        }}>{value}{valueExtra}{textExtra || ''}</div>
                        <div className="gauge-label" style={{ marginTop: className === 'io' ? ioTransformLabelMarginTop : undefined }}>
                            {label}
                            {!isSmallScreen && labelExtras ? ' / ' + labelExtras : ''}
                        </div>
                        {isSmallScreen &&
                            <div className="gauge-label">
                                {labelExtras}
                            </div>
                        }
                    </div>
                </div>
            </div>
        </div>
    );
};

const shouldPowerSave = () => {
    return Date.now() - store.lastPanelActive > POWERSAVE_MS;
}

const exitPowerSaveIfNeeded = () => {
    let now = Date.now();
    console.log('exitPowerSave', -1);
    if (now - store.lastPanelActive <= POWERSAVE_MS) { // in powersave mode
        if (now - store.lastPanelActive > RELAX_BUFFER_MS) { // prevent infinite update
            store.lastPanelActive = now;
        }
        return;
    }
    store.powerSaveAnimState = 0;
    store.lastPanelActive = now;
    console.log('exitPowerSave', 0);
    requestAnimationFrame(() => {
        store.powerSaveAnimState = 1;
        console.log('exitPowerSave', 1);
    })
}

const Monitor = observer(() => {
    let loadLevel = 0;
    let fullLoadItems = Object.values(store.usage).filter(u => u >= 80).length;
    if (fullLoadItems >= 3) {
        loadLevel = 2;
    } else if (fullLoadItems === 2) {
        loadLevel = 1;
    }
    let sectionMinHeight = undefined;
    let infoFontSize = undefined;
    let infoWidth = 220;
    let infoMT = undefined;
    let isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;
    let isSmallLandscape = isSmallScreen && store.windowWidth > store.windowHeight;
    if (isSmallScreen) {
        sectionMinHeight = 170;
        infoFontSize = '70%';
        infoWidth = 150;
        infoMT = -20;
    }

    console.log('render');
    let fsMessage = (() => {
        if (store.lastUpdate === 0) return (
            <>
                <div style={{ fontSize: '4em' }}>🌐</div>
                <div style={{ fontSize: '3em' }}>Connecting...</div>
            </>
        )
        if (store.uiPollingTimestamp - store.firstDataPushedAt < 200) return (
            <>
                <div style={{ fontSize: '4em' }}>🌐</div>
                <div style={{ fontSize: '3em' }}>Connected</div>
            </>
        )
        if (store.vaState >= 2) {
            exitPowerSaveIfNeeded();
            let filter = (() => {
                if (store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                    if (!store.isUserSpeaking) return 'saturate(0.3) opacity(0.3)'
                    return '';
                }
                if (store.vaState === STATE.SENDING_AUDIO) return 'opacity(0.5)';
                if (store.vaState === STATE.PLAYING_TTS) return '';
            })();
            let stateToTransform = (num) => {
                if (num === 1) return 'translateY(-20px)';
                if (num === 2) return 'translateY(20px)';
                return 'translateY(0px)';
            }
            let stateToOpacity = (num, opacity = 1) => {
                if (num === 1) return 0;
                if (num === 2) return 0;
                return opacity;
            }

            return (
                <>
                    <dotlottie-player
                        src={ASSETS_HOST + "/vendor/ai.lottie"}
                        background="transparent"
                        speed={0.5}
                        style={{
                            width: '400px',
                            height: '400px',
                            filter
                        }} // JSX style object
                        loop
                        autoplay
                    ></dotlottie-player>
                    <div style={{
                        position: 'absolute',
                        textAlign: 'center',
                        width: '90%',
                        height: '80%'
                    }}>
                        <div style={{
                            position: 'absolute', top: '0', width: '100%',
                        }}>
                            <div style={{
                                fontSize: '2em',
                                transition: 'all 0.3s ease-in-out',
                                lineHeight: '1.3em',
                                width: '100%',
                                transform: stateToTransform(store.lastSTTAnimState),
                                opacity: stateToOpacity(store.lastSTTAnimState, store.latestText === 0 ? 1 : 0.5)
                            }}
                            >{store.lastSTT}</div>
                        </div>
                        <div style={{
                            position: 'absolute', bottom: '0', width: '100%',
                        }}>
                            <div style={{
                                fontSize: '2em',
                                transition: 'all 0.3s ease-in-out',
                                lineHeight: '1.3em',
                                width: '100%',
                                transform: stateToTransform(store.lastTTSAnimState),
                                opacity: stateToOpacity(store.lastTTSAnimState, store.latestText === 1 ? 1 : 0.5)
                            }}
                            >{store.lastTTS}</div>
                        </div>
                    </div>
                </>
            )
        }
        let isTimeout = store.lastUpdate > 0 && Math.max(store.uiPollingTimestamp, Date.now()) - store.lastUpdate > 5000;
        if (isTimeout) {
            exitPowerSaveIfNeeded();

            return (
                <>
                    <div style={{ fontSize: '4em' }}>⚠️</div>
                    <div style={{ fontSize: '3em' }}>Connection Lost</div>
                    <div style={{ fontSize: '1em' }}>{formatTimeDiff(store.lastUpdate)}</div>
                </>
            )
        }
    })();

    const isUsingBackupNetwork = store.io.isUsingBackup;
    const isSmallPortrait = false;

    return (
        <>
            <div className="container" style={{ display: isSmallPortrait ? 'flex' : undefined, flexWrap: isSmallPortrait ? 'wrap' : undefined, maxWidth: isSmallPortrait ? '100vw' : undefined }}>
                <div style={{ paddingTop: location.hostname.includes('direct2') ? 30 : 10 }}></div>
                <div className="section" style={{ minHeight: sectionMinHeight, width: isSmallPortrait ? 'calc(50% - 40px)' : undefined, marginRight: isSmallPortrait ? 80 : undefined }}>
                    <div className="section-title">Temperature</div>
                    <div className="gauge-container">
                        <Gauge
                            value={store.temperatures.cpu}
                            min={store.GAUGE_LIMITS.temperature.cpu.min}
                            max={store.GAUGE_LIMITS.temperature.cpu.max}
                            label="CPU"
                            className="temperature"
                            featherName="cpu"
                        />
                        <Gauge
                            value={store.temperatures.gpu}
                            min={store.GAUGE_LIMITS.temperature.gpu.min}
                            max={store.GAUGE_LIMITS.temperature.gpu.max}
                            label="GPU"
                            className="temperature"
                            featherName="image"
                            gpuPwr
                        />
                        <Gauge
                            value={store.temperatures.ssd}
                            min={store.GAUGE_LIMITS.temperature.ssd.min}
                            max={store.GAUGE_LIMITS.temperature.ssd.max}
                            label="SSD"
                            className="temperature"
                            featherName="hard-drive"
                            clickFn={() => showStorageInfo("system")}
                            textColor={STORAGE_TEXT_COLOR[store.storageInfo.system?.info?.status || 0]}
                            textExtra={STORAGE_EXTRA_TEXT[store.storageInfo.system?.info?.status || 0]}
                        />
                    </div>
                </div>
                <div className="section" style={{ minHeight: sectionMinHeight, width: isSmallLandscape ? 'calc(50% - 40px)' : undefined }}>
                    <div className="section-title">Usage</div>
                    <div className="gauge-container" style={{ marginTop: isSmallLandscape ? 25 : undefined }}>
                        <Gauge value={store.usage.cpu} max={100} label="CPU" className="usage" featherName="cpu" small cpuFreq />
                        <Gauge value={store.usage.gpu} max={100} label="GPU" className="usage" featherName="image" small gpuFreq />
                        <Gauge value={store.usage.ram} valueMB={store.usageMB.ram} max={100} label="RAM" className="usage" featherName="server" small />
                        <Gauge value={store.usage.vram} valueMB={store.usageMB.vram} max={100} label="VRAM" className="usage" featherName="monitor" small />
                    </div>
                </div>
                <div className="section" style={{
                    minHeight: sectionMinHeight,
                    width: isSmallLandscape ? 'calc(50% - 40px)' : undefined,
                    marginRight: isSmallLandscape ? 40 : undefined,
                    marginTop: isSmallLandscape ? 10 : undefined
                }}>
                    <div className="section-title">I/O</div>
                    <div className="gauge-container" style={{
                        marginTop: isSmallLandscape ? 20 : undefined
                    }}>
                        <Gauge
                            value={store.io.diskRead}
                            max={store.GAUGE_LIMITS.io.diskRead.max}
                            label="Disk Read"
                            className="io"
                            featherName="hard-drive"
                            small
                        />
                        <Gauge
                            value={store.io.diskWrite}
                            max={store.GAUGE_LIMITS.io.diskWrite.max}
                            label="Disk Write"
                            className="io"
                            featherName="activity"
                            small
                        />
                        <Gauge
                            value={isUsingBackupNetwork ? store.io.backupNetworkRx : store.io.networkRx}
                            max={isUsingBackupNetwork ? store.GAUGE_LIMITS.io.backupNetworkRx.max : store.GAUGE_LIMITS.io.networkRx.max}
                            label="Network RX"
                            labelExtra={formatBytes(isUsingBackupNetwork ? store.io.backupNetworkPacketsRx : store.io.networkPacketsRx, 1, 'PPS')}
                            className="io"
                            featherName="globe"
                            small
                            textColor={isUsingBackupNetwork ? '#F7EE7F' : undefined}
                        />
                        <Gauge
                            value={isUsingBackupNetwork ? store.io.backupNetworkTx : store.io.networkTx}
                            max={isUsingBackupNetwork ? store.GAUGE_LIMITS.io.backupNetworkTx.max : store.GAUGE_LIMITS.io.networkTx.max}
                            label="Network TX"
                            labelExtra={formatBytes(isUsingBackupNetwork ? store.io.backupNetworkPacketsTx : store.io.networkPacketsTx, 1, 'PPS')}
                            className="io"
                            featherName="globe"
                            small
                            textColor={isUsingBackupNetwork ? '#F7EE7F' : undefined}
                        />
                    </div>
                </div>
                <div style={{
                    display: 'flex',
                    marginTop: isSmallLandscape ? 10 : infoMT,
                    width: isSmallLandscape ? 'calc(50% - 40px)' : undefined,
                    flexGrow: isSmallLandscape ? 1 : undefined
                }} >
                    <div className="section" style={{ flexGrow: 1, minHeight: sectionMinHeight }}  >
                        <div className="section-title">Fan Speed</div>
                        <div className="gauge-container">
                            <Gauge
                                value={store.fanSpeed.cpu}
                                max={store.GAUGE_LIMITS.fanSpeed.cpu.max}
                                label="CPU"
                                className="fan"
                                featherName="cpu"
                            />
                            <Gauge
                                value={store.fanSpeed.motherboard}
                                max={store.GAUGE_LIMITS.fanSpeed.motherboard.max}
                                label="Motherboard"
                                className="fan"
                                featherName="server"
                            />
                        </div>

                    </div>
                    <div className="section" style={{ display: 'flex', width: isSmallPortrait ? 150 : infoWidth, minHeight: sectionMinHeight }} >
                        <div className="section-title">&nbsp;</div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'end',
                            justifyContent: 'end',
                            paddingBottom: isSmallScreen ? 0 : 10,
                            width: '100%',
                            fontSize: infoFontSize,
                            zIndex: 0
                        }}>
                            <div style={{ fontSize: '1.5em', fontWeight: 600, zIndex: -2, color: COLOR_STOPS[loadLevel].color }}>
                                {store.SYSTEM_INFO.hostname}
                            </div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.cpu}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.gpu}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.case}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.os}</div>
                            <div style={{ fontWeight: 500, opacity: 0.8 }}>{store.system}</div>
                            <div style={{ fontWeight: 600 }}>{getGMT8Time(store.lastUpdate)}</div>
                        </div>
                    </div>
                </div>
                {
                    store.networkMetrics?.ping_statistics?.minute_history && (
                        <div style={{
                            width: '100%',
                            paddingTop: isSmallLandscape ? 8 : 16,
                            paddingBottom: 16,
                            cursor: 'pointer',
                            transform: 'scale(1)',
                            transition: 'transform 0.2s ease-in-out, filter 0.2s ease-in-out'
                        }}
                            onMouseEnter={window.matchMedia("(hover: hover) and (pointer: fine)").matches ? (e) => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.filter = 'brightness(1.5)'; } : undefined}
                            onMouseLeave={window.matchMedia("(hover: hover) and (pointer: fine)").matches ? (e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'brightness(1)'; } : undefined}
                            onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.filter = 'brightness(1.5)'; }}
                            onTouchEnd={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'brightness(1)'; }}
                            onClick={() => {
                                const formatShort = (date) => {
                                    return new Intl.DateTimeFormat('en-US', {
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: false
                                    }).format(date).replace(/, (\d+):/, ', $1:');
                                };

                                const pingMetrics = store.networkMetrics.ping_statistics;
                                const trafficMetrics = store.networkMetrics.network_traffic;

                                // Helper to safely get value or 'N/A'
                                const getVal = (val, suffix = '') => (val !== null && val !== undefined) ? `${val}${suffix}` : 'N/A';

                                const tableRows = [
                                    { period: '1m', data: trafficMetrics.historical.last1m },
                                    { period: '5m', data: trafficMetrics.historical.last5m },
                                    { period: '15m', data: trafficMetrics.historical.last15m },
                                    { period: '1h', data: trafficMetrics.historical.last1h },
                                    { period: '3h', data: trafficMetrics.historical.last3h },
                                    { period: '12h', data: trafficMetrics.historical.last12h },
                                    { period: '24h', data: trafficMetrics.historical.last1d },
                                    { period: '3d', data: trafficMetrics.historical.last3d },
                                    { period: '7d', data: trafficMetrics.historical.last7d },
                                    { period: '30d', data: trafficMetrics.historical.last30d },
                                ];

                                const pingLatencyRows = [
                                    { period: 'Now', latency: pingMetrics.latency.latest, packetLoss: pingMetrics.packet_loss.latest_percent },
                                    { period: '1m', latency: pingMetrics.latency.last1m, packetLoss: pingMetrics.packet_loss.last1m },
                                    { period: '5m', latency: pingMetrics.latency.last5m, packetLoss: pingMetrics.packet_loss.last5m },
                                    { period: '1h', latency: pingMetrics.latency.last1h, packetLoss: pingMetrics.packet_loss.last1h },
                                    { period: '24h', latency: pingMetrics.latency.last24h, packetLoss: pingMetrics.packet_loss.last24h },
                                ];

                                // Calculate column widths for Traffic Table
                                let maxPeriodWidth = 'T'.length;
                                let maxRxAvgWidth = 'RX μ/s'.length; // Account for /s here
                                let maxRxTotalWidth = 'RX Σ'.length;
                                let maxTxAvgWidth = 'TX μ/s'.length; // Account for /s here
                                let maxTxTotalWidth = 'TX Σ'.length;

                                for (const row of tableRows) {
                                    maxPeriodWidth = Math.max(maxPeriodWidth, row.period.length);
                                    maxRxAvgWidth = Math.max(maxRxAvgWidth, (formatBytes(row.data.avg_rx_Bps, 1, 'B', false) + '/s').length);
                                    maxRxTotalWidth = Math.max(maxRxTotalWidth, formatBytes(row.data.cum_rx, 1, 'B', false).length);
                                    maxTxAvgWidth = Math.max(maxTxAvgWidth, (formatBytes(row.data.avg_tx_Bps, 1, 'B', false) + '/s').length);
                                    maxTxTotalWidth = Math.max(maxTxTotalWidth, formatBytes(row.data.cum_tx, 1, 'B', false).length);
                                }

                                // Build the traffic table string
                                const trafficHeader = `${'T'.padEnd(maxPeriodWidth)} | ${'RX μ/s'.padEnd(maxRxAvgWidth)} | ${'RX Σ'.padEnd(maxRxTotalWidth)} | ${'TX μ/s'.padEnd(maxTxAvgWidth)} | ${'TX Σ'.padEnd(maxTxTotalWidth)}`;
                                const trafficSeparator = `${'-'.repeat(maxPeriodWidth)} - ${'-'.repeat(maxRxAvgWidth)} - ${'-'.repeat(maxRxTotalWidth)} - ${'-'.repeat(maxTxAvgWidth)} - ${'-'.repeat(maxTxTotalWidth)}`;

                                const trafficRows = tableRows.map(row => {
                                    const rxAvg = formatBytes(row.data.avg_rx_Bps, 1, 'B', false) + '/s';
                                    const rxTotal = formatBytes(row.data.cum_rx, 1, 'B', false);
                                    const txAvg = formatBytes(row.data.avg_tx_Bps, 1, 'B', false) + '/s';
                                    const txTotal = formatBytes(row.data.cum_tx, 1, 'B', false);
                                    return `${row.period.padEnd(maxPeriodWidth)} | ${rxAvg.padEnd(maxRxAvgWidth)} | ${rxTotal.padEnd(maxRxTotalWidth)} | ${txAvg.padEnd(maxTxAvgWidth)} | ${txTotal.padEnd(maxTxTotalWidth)}`;
                                }).join('\n');

                                const trafficTable = [trafficHeader, trafficSeparator, trafficRows].join('\n');

                                // Calculate column widths for Ping/Latency Table
                                let maxPingPeriodWidth = 'T'.length;
                                let maxLatencyWidth = 'Latency (ms)'.length;
                                let maxPacketLossWidth = 'Packet Loss (%)'.length;

                                for (const row of pingLatencyRows) {
                                    maxPingPeriodWidth = Math.max(maxPingPeriodWidth, row.period.length);
                                    // Ensure getVal is called with correct suffix for length calculation
                                    maxLatencyWidth = Math.max(maxLatencyWidth, getVal(row.latency, 'ms').length);
                                    maxPacketLossWidth = Math.max(maxPacketLossWidth, getVal(row.packetLoss, '%').length);
                                }

                                // Build the ping/latency table string
                                const pingHeader = `${'T'.padEnd(maxPingPeriodWidth)} | ${'Latency (ms)'.padEnd(maxLatencyWidth)} | ${'Packet Loss (%)'.padEnd(maxPacketLossWidth)}`;
                                const pingSeparator = `${'-'.repeat(maxPingPeriodWidth)} - ${'-'.repeat(maxLatencyWidth)} - ${'-'.repeat(maxPacketLossWidth)}`;

                                const pingRows = pingLatencyRows.map(row => {
                                    const latency = getVal(row.latency, 'ms');
                                    const packetLoss = getVal(row.packetLoss, '%');
                                    return `${row.period.padEnd(maxPingPeriodWidth)} | ${latency.padEnd(maxLatencyWidth)} | ${packetLoss.padEnd(maxPacketLossWidth)}`;
                                }).join('\n');

                                const pingTable = [pingHeader, pingSeparator, pingRows].join('\n');

                                let message = `Active Connections: ${store.io.activeConn}

Open Ports: ${store.networkMetrics.internet_ports.map(s => s.replace(/open/g, '').trim())?.join(', ') || 'None'}

${pingTable}

${trafficTable}

Recent outages:
${pingMetrics.outages.reverse().map(o => {
                                    const start = formatShort(new Date(o.start));
                                    const end = formatShort(new Date(o.end));
                                    const mins = Math.floor(o.duration_seconds / 60);
                                    const secs = o.duration_seconds % 60;
                                    return `- ${start} – ${end} (${mins}m${secs}s)`;
                                }).join('\n') || 'None in last 24 hours'}

Last updated: ${formatTimeDiff(store.networkMetrics?.last_updated)}`;
                                panelAlert(message, 'Network Info');
                            }}>
                            <div style={{
                                display: 'flex',
                                flexGrow: isSmallLandscape ? 1 : undefined,
                                justifyContent: 'space-between',
                                position: 'relative',
                                zIndex: 2
                            }}>
                                {store.networkMetrics?.ping_statistics?.minute_history.map((h, i, arr) => {
                                    const timestamp = new Date(store.networkMetrics.ping_statistics.minute_history[i].timestamp);
                                    const formattedTime = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                width: '100%',
                                                marginRight: i + 1 === arr.length ? 0 : (isSmallScreen ? '0.05em' : '1px'),
                                                height: 20,
                                                opacity: 1 - ((arr.length - (i + 1)) * 0.015),
                                                backgroundColor: h.latency_ms === null || h.latency_ms === -1
                                                    ? '#444444'
                                                    : getColorAtPercent(Math.min(100, Math.max((h.latency_ms ** 2) / 10, h.packet_loss_percent))),
                                                position: 'relative'
                                            }}
                                            title={`Time: ${formattedTime}\nLatency: ${h.latency_ms !== null && h.latency_ms !== -1 ? h.latency_ms + 'ms' : 'N/A'}\nPacket Loss: ${h.packet_loss_percent !== null && h.packet_loss_percent !== -1 ? h.packet_loss_percent + '%' : 'N/A'}`}
                                        >
                                        </div>
                                    );
                                })}

                            </div>
                            {store.networkMetrics?.network_traffic?.minute_history && (
                                <div style={{
                                    width: '100%',
                                    paddingTop: 1,
                                    paddingBottom: -3,
                                    cursor: 'pointer',
                                    transform: 'scale(1)',
                                    transition: 'transform 0.2s ease-in-out, filter 0.2s ease-in-out'
                                }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        flexGrow: undefined,
                                        justifyContent: 'space-between',
                                        position: 'relative',
                                        zIndex: 2
                                    }}>
                                        {store.networkMetrics?.network_traffic?.minute_history.map((h, i, arr) => {
                                            const timestamp = new Date(store.networkMetrics.network_traffic.minute_history[i].timestamp);
                                            const formattedTime = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                                            let traffic = h.avg_rx_Bps + h.avg_tx_Bps;
                                            let noTraffic = traffic === 0;
                                            let rx = formatBytes(h.avg_rx_Bps, 1, 'B/s');
                                            let tx = formatBytes(h.avg_tx_Bps, 1, 'B/s');
                                            let rxPct = h.avg_rx_Bps / store.GAUGE_LIMITS.io.networkRx.max;
                                            let txPct = h.avg_tx_Bps / store.GAUGE_LIMITS.io.networkTx.max;
                                            let pct = Math.min(100, (rxPct ** 0.4) * 100, (txPct ** 0.4) * 100);
                                            return (
                                                <div
                                                    key={i}
                                                    style={{
                                                        width: '100%',
                                                        height: 2,
                                                        opacity: 1 - ((arr.length - (i + 1)) * 0.015),
                                                        backgroundColor: noTraffic
                                                            ? '#444444'
                                                            : getColorAtPercent(pct),
                                                        position: 'relative'
                                                    }}
                                                    title={`Time: ${formattedTime}\nRX: ${!noTraffic ? rx : 'N/A'}\nTX: ${!noTraffic ? tx : 'N/A'}\nPCT: ${pct}`}
                                                >

                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                            )}
                            {store.networkMetrics?.ping_statistics?.latency && (
                                <div style={{
                                    zIndex: 2,
                                    marginTop: 4,
                                    justifyContent: 'space-between',
                                    position: 'relative',
                                    fontSize: '0.8em',
                                    display: 'flex'
                                }}>
                                    <div
                                        style={{ fontWeight: 400, opacity: 0.5, marginLeft: -2, }}
                                    >{store.networkMetrics?.internet_ports.map(s => s.replace(/open/g, '').trim()).join(', ')}
                                    </div>
                                    <div style={{
                                        fontWeight: 400,
                                        opacity: 0.8,
                                        marginRight: -2,
                                        color: getColorAtPercent(Math.min(100, Math.max(
                                            ((store.networkMetrics?.ping_statistics?.latency.last1m || store.networkMetrics.ping_statistics.latency.latest) ** 2) / 10,
                                            store.networkMetrics?.ping_statistics?.packet_loss.last1m)
                                        ))
                                    }} >
                                        {Date.now() - store.networkMetrics?.last_updated > 7000 && <>{formatTimeDiff(store.networkMetrics?.last_updated)} •&nbsp;</>}
                                        {store.io.activeConn} conns •&nbsp;
                                        {store.networkMetrics?.ping_statistics?.latency.last1m?.toFixed(1) || store.networkMetrics.ping_statistics.latency.latest?.toFixed(1)}ms •&nbsp;
                                        {store.networkMetrics?.ping_statistics?.packet_loss.last1m?.toFixed(1)}% loss
                                    </div>

                                </div>
                            )}
                        </div >
                    )}
            </div >
            {!shouldPowerSave() &&
                <div style={{
                    display: 'flex',
                    width: '100%',
                    height: '100%',
                    position: 'fixed',
                    zIndex: 6,
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: (!!store.alertMessage && (store.alertExpire > Math.max(store.uiPollingTimestamp, Date.now()))) ? null : 'none',
                    // backdropFilter: 'blur(4px) brightness(0.65)',
                    transition: 'all 0.3s ease-in-out',
                    opacity: (store.powerSaveAnimState && !!store.alertMessage && (store.alertExpire > Math.max(store.uiPollingTimestamp, Date.now()))) ? 1 : 0,
                }}
                    onClick={() => {
                        store.alertExpire = 0;
                    }}>
                    <div className="container" style={{
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        paddingTop: 20,
                        paddingRight: 20,
                        paddingLeft: 20,
                        borderRadius: 20,
                    }} onClick={(e) => {
                        e.stopPropagation();
                    }}>
                        <div style={{ textAlign: 'center', fontSize: '1.5em' }}>{!!store.alertMessage && store.alertMessage[0]}</div>
                        <div style={{
                            maxHeight: 'calc(100vh - 100px)',
                            overflow: 'scroll'
                        }}>
                            <pre style={{
                                margin: 0,
                                padding: 0,
                                whiteSpace: 'pre-wrap',
                                fontSize: '0.75em',
                                paddingBottom: 20
                            }}>
                                {!!store.alertMessage && store.alertMessage[1]}
                            </pre>
                        </div>
                    </div>
                </div>
            }
            {
                !shouldPowerSave() &&
                <div style={{
                    position: 'fixed',
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#232323f0',
                    // backdropFilter: 'blur(4px) brightness(0.65)',
                    display: 'flex',
                    opacity: store.powerSaveAnimState && fsMessage ? 1 : 0,
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 5,
                    marginLeft: -20,
                    marginRight: -20,
                    transition: 'all 0.5s ease-in-out',
                    pointerEvents: store.vaState >= 2 ? null : 'none'
                }} onClick={() => {
                    if (store.vaState === STATE.PLAYING_TTS) {
                        setVAState(STATE.WAKE_WORD_TRIGGERED); // Interrupt TTS and listen again
                        return;
                    }
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && !store.isUserSpeaking) {
                        pipelineActive = false; // Cancel listening
                        resetAudioStreamingState();
                        setVAState(STATE.IDLE);
                        return;
                    }
                    if (store.vaState === STATE.SENDING_AUDIO) {
                        resetAll(false);
                    }
                }}>
                    {fsMessage}
                </div>
            }
        </>
    )
});

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <Observer>{() => <Monitor />}</Observer>
    </React.StrictMode>
);

function formatTimeDiff(timestamp) {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000); // seconds

    if (diff < 60) return `${diff} seconds ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
}

function formatHealthReport(section, data) {
    const info = data.info;
    const smart = info.metrics.smart;
    const fs = info.metrics.filesystem;
    const lastUpdate = formatTimeDiff(data.lastUpdate);

    return `Storage Health Report for [${section}] (${data.paths.join(', ')})
Status: ${info.statusText}
Last updated: ${lastUpdate}

Drive Health:
• Spare blocks: ${smart.spare.formatted}
• Wear level: ${smart.wear.formatted}
• Media errors: ${smart.mediaErrors.formatted}
• Age: ${smart.powerOnTime.formatted}
• Total written: ${smart.dataWritten.formatted}
• Total read: ${smart.dataRead.formatted}

BTRFS Status:
• Write errors: ${fs.writeErrors}
• Read errors: ${fs.readErrors}
• Flush errors: ${fs.flushErrors}
• Corruption errors: ${fs.corruptionErrors}
• Generation errors: ${fs.generationErrors}

${info.issues.length > 0 ? '\nIssues Found:\n' + info.issues.map(issue => '• ' + issue).join('\n') : 'No issues found.'}`
}


function showStorageInfo(section) {
    console.log(section, JSON.parse(JSON.stringify(store.storageInfo[section])))
    panelAlert(formatHealthReport(section, store.storageInfo[section]), `Storage Info (${section})`)
}

function panelAlert(content, title, expire = 10000) {
    exitPowerSaveIfNeeded();
    store.alertMessage = [title, content];
    store.alertExpire = Date.now() + 10000;
}

function setVolume(volume) {
    let newVolume = DAY_VOL * 100; // Current day volume as percentage
    if (typeof volume === 'string') {
        const trimmedVolume = volume.trim();
        if (trimmedVolume.startsWith('+')) {
            const increment = parseInt(trimmedVolume.substring(1)) || 10;
            newVolume += increment;
        } else if (trimmedVolume.startsWith('-')) {
            const decrement = parseInt(trimmedVolume.substring(1)) || 10;
            newVolume -= decrement;
        } else {
            newVolume = parseInt(trimmedVolume);
        }
    } else {
        newVolume = volume;
    }
    newVolume = Math.max(0, Math.min(100, newVolume));
    DAY_VOL = newVolume / 100;
    NIGHT_VOL = (Math.pow(newVolume, NIGHT_VOL_EXPONENT)) / 100; // Maintain proportion if desired
    localStorage.setItem('day_volume', DAY_VOL.toString());
    localStorage.setItem('night_volume', NIGHT_VOL.toString());
    panelAlert('', `Volume set to ${parseInt(newVolume)}%`, 3000);
    console.log(`Volume set to: DAY_VOL=${DAY_VOL}, NIGHT_VOL=${NIGHT_VOL}`);
}

const socket = io();


let saveToMobxStore = (label) => (data) => {
    try {
        // Parse the incoming data if it's a string
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        for (let k of Object.keys(info)) {
            store[k] = info[k];
            // console.log(k, info[k]);
        }
        let now = Date.now();
        if (store.firstDataPushedAt === 0) {
            store.firstDataPushedAt = now;
        }
        store.lastDataPushedAt = now;
        if (now - store.uiPollingTimestamp > RELAX_BUFFER_MS) {
            store.uiPollingTimestamp = now;
            console.log('store.uiPollingTimestamp = now', 'saveToMobxStore');
        }
        // console.log('saveToMobxStore', label);
    } catch (error) {
        console.error(`Error processing ${label}:`, error);
    }
};

socket.on('storageInfo', saveToMobxStore('storageInfo'));
socket.on('initInfo', saveToMobxStore('initInfo'));
socket.on('metrics', saveToMobxStore('metrics'));

// Listen for connection
socket.on('connect', () => {
    console.log('Connected to server');
});

window.addEventListener('resize', () => {
    store.windowWidth = window.innerWidth;
    store.windowHeight = window.innerHeight;
});


// Global state variables
let myvad = null;
let haWebSocket = null;
let bumblebee = null;

let currentMessageId = 0;
let pipelineActive = false; // Still useful to indicate active HA pipeline communication
let haReadyForAudio = false;
let currentPipelineRunId = null;
let currentPipelineListRequestId = null;
let currentDeviceConfigRequestId = null;
let sttBinaryHandlerId = null;

let wakeWordTimeoutId = null;
let ttsAudioElement = null;           // To control TTS playback
let conversationId = newConversationId();
const audioCache = {};
// Configuration - HA_URL is constant, TOKEN and PIPELINE_NAME are fetched
let HA_TOKEN = null;
let HA_ASSIST_PIPELINE_NAME = null;

// --- Helper Functions ---
function getStateName(stateValue) {
    return Object.keys(STATE).find(key => STATE[key] === stateValue) || 'UNKNOWN_STATE';
}
async function fetchAndCacheAudio(url, short) {
    if (audioCache[url]) {
        return audioCache[url].cloneNode();
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audioCache[url] = audio; // Cache the audio element
        audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
        audio.addEventListener('error', () => URL.revokeObjectURL(audioUrl), { once: true });
        if (short) {
            setTimeout(() => {
                delete audioCache[url];
            }, 60000);
        }
        return audio.cloneNode(); // Return a clone for playback
    } catch (e) {
        console.error('Failed to fetch and cache audio:', url, e);
        return new Audio(url); // Fallback to direct New Audio if fetch fails
    }
}

async function playAudio(url) {
    let v = DAY_VOL;
    const currentHour = new Date().getHours();
    if (currentHour >= 23 || currentHour < 8) { // Between 11 PM and 8 AM
        v = NIGHT_VOL;
    }
    try {
        const audio = await fetchAndCacheAudio(url);
        audio.volume = v;
        return audio.play().catch(e => console.error('Error playing audio from cache:', e));
    } catch (e) {
        console.error('Error getting audio from cache/fetching, falling back:', e);
        const audio = new Audio(url);
        audio.volume = v;
        return audio.play().catch(e => console.error('Error playing audio fallback:', e));
    }
}

function killTTS() {
    if (ttsAudioElement) {
        ttsAudioElement.pause();
        ttsAudioElement.src = '';
        ttsAudioElement.onended = null;
        ttsAudioElement.onerror = null;
        ttsAudioElement = null;
    }
}

// --- State Management ---
function setVAState(newState, ...args) {
    const oldState = store.vaState;
    // if (oldState === newState) return; // Usually, but some states might re-run entry logic

    console.log(`State transition: ${getStateName(oldState)} -> ${getStateName(newState)} ${args.length > 0 ? JSON.stringify(args) : ''}`);
    store.vaState = newState;

    // Clear any state-specific timers/handlers from the OLD state
    if (wakeWordTimeoutId) {
        clearTimeout(wakeWordTimeoutId);
        wakeWordTimeoutId = null;
    }

    if (oldState === STATE.PLAYING_TTS && newState !== STATE.PLAYING_TTS) {
        console.log("Stopping TTS audio due to state change from PLAYING_TTS.");
        killTTS();
    }

    // Actions for ENTERING the new state
    switch (newState) {
        case STATE.INITIALIZING:
            break;

        case STATE.IDLE:
            pipelineActive = false;
            resetAudioStreamingState();

            if (myvad && myvad.listening) {
                console.log("STATE.IDLE: VAD was listening, pausing it.");
                myvad.pause();
            }

            if (oldState >= STATE.WAKE_WORD_TRIGGERED) {
                playAudio(BASE + '/cancel.mp3').catch(e => console.error('Error playing cancel.mp3:', e));
            }

            if (bumblebee) {
                bumblebee.start();
            }
            break;

        case STATE.WAKE_WORD_TRIGGERED:
            pipelineActive = false;
            store.isUserSpeaking = false;
            exitPowerSaveIfNeeded();

            const startVADAndSetTimeout = async () => {
                if (store.vaState !== STATE.WAKE_WORD_TRIGGERED) return; // State changed

                if (!myvad) {
                    console.error("STATE.WAKE_WORD_TRIGGERED: VAD not initialized!");
                    panelAlert("Voice detection system is not ready.");
                    setVAState(STATE.IDLE);
                    return;
                }

                if (!myvad.listening) {
                    console.log("STATE.WAKE_WORD_TRIGGERED: Starting VAD listening.");
                    myvad.start();
                } else {
                    console.log("STATE.WAKE_WORD_TRIGGERED: VAD already listening.");
                }

                playAudio(BASE + '/activate.mp3').catch(e => console.error('Error playing activate.mp3:', e));

                wakeWordTimeoutId = setTimeout(() => {
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && !pipelineActive) { // No speech started
                        console.log("Wake word timeout: No speech detected (onSpeechStart not called).");
                        // panelAlert("No speech detected. Please try again.");
                        if (myvad && myvad.listening) myvad.pause();
                        setVAState(STATE.IDLE);
                    }
                }, WAKE_WORD_SPEECH_TIMEOUT);
            };

            (async () => {
                if (store.vaState !== STATE.WAKE_WORD_TRIGGERED) return;

                if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
                    console.log("STATE.WAKE_WORD_TRIGGERED: WebSocket not open. Attempting to connect...");
                    try {
                        await connectWebSocket();
                        if (store.vaState !== STATE.WAKE_WORD_TRIGGERED) return; // State changed
                        if (!myvad) await initializeVAD();
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) startVADAndSetTimeout();
                    } catch (err) {
                        console.error("STATE.WAKE_WORD_TRIGGERED: Error ensuring WS/VAD readiness:", err);
                        panelAlert("Failed to prepare for voice input: " + err.message);
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) setVAState(STATE.IDLE);
                    }
                } else if (!myvad) {
                    console.log("STATE.WAKE_WORD_TRIGGERED: VAD not initialized. Attempting VAD init...");
                    try {
                        await initializeVAD();
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) startVADAndSetTimeout();
                    } catch (err) {
                        console.error("STATE.WAKE_WORD_TRIGGERED: Error initializing VAD:", err);
                        panelAlert("Failed to initialize voice detection: " + err.message);
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) setVAState(STATE.IDLE);
                    }
                } else {
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED) startVADAndSetTimeout();
                }
            })();
            break;

        case STATE.SENDING_AUDIO:
            exitPowerSaveIfNeeded();
            if (!pipelineActive) {
                console.warn("STATE.SENDING_AUDIO: Entered but pipelineActive is false. Reverting to IDLE.");
                setVAState(STATE.IDLE);
                return;
            }
            playAudio(BASE + '/analyzing.mp3').catch(e => console.error('Error playing analyzing.mp3:', e));

            console.log("STATE.SENDING_AUDIO: Waiting for Home Assistant response.");
            // VAD should have been paused by onSpeechEnd
            break;

        case STATE.PLAYING_TTS:
            exitPowerSaveIfNeeded();
            const ttsUrl = args[0];
            if (!ttsUrl) {
                setVAState(STATE.WAKE_WORD_TRIGGERED);
                return;
            }
            pipelineActive = false;
            killTTS();
            (async () => {
                try {
                    ttsAudioElement = await fetchAndCacheAudio(ttsUrl, true);
                    ttsAudioElement.playbackRate = store.lastTTSLength > 20 ? 1.5 : 1.25;
                    ttsAudioElement.onended = () => {
                        ttsAudioElement = null;
                        if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                    };
                    ttsAudioElement.onerror = (e) => {
                        // panelAlert("Error playing assistant response. E2: " + e.message);
                        ttsAudioElement = null;
                        if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                    };
                    let v = DAY_VOL;
                    const currentHour = new Date().getHours();
                    if (currentHour >= 23 || currentHour < 8) { // Between 11 PM and 8 AM
                        v = NIGHT_VOL;
                    }
                    ttsAudioElement.volume = v;
                    await ttsAudioElement.play();

                    if (!myvad.listening) {
                        console.log("STATE.PLAYING_TTS: Starting VAD listening.");
                        myvad.start();
                    } else {
                        console.log("STATE.PLAYING_TTS: VAD already listening.");
                    }
                } catch (e) {
                    panelAlert("Could not play assistant response. E2: " + e.message);
                    if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                }
            })();
            break;
    }
}

// --- Configuration Fetching ---
function getConfigValue(paramName, storageKey) {
    // return null;
    const urlParams = new URLSearchParams(window.location.search);
    const valueFromUrl = urlParams.get(paramName);
    if (valueFromUrl) {
        localStorage.setItem(storageKey, valueFromUrl);
        urlParams.delete(paramName);
        const newSearch = urlParams.toString();
        const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
        window.history.replaceState({}, document.title, newUrl);
        return valueFromUrl;
    }
    return localStorage.getItem(storageKey);
}

function getHAToken() { return getConfigValue('token', 'ha_token'); }
function getHAPipelineName() { return getConfigValue('pipeline_name', 'ha_pipeline_name'); }

// --- Main Application Initialization ---
async function initializeApp() {
    setVAState(STATE.INITIALIZING); // Set initial state
    console.log("Initializing application...");

    HA_TOKEN = getHAToken();
    HA_ASSIST_PIPELINE_NAME = getHAPipelineName();

    await Promise.all([
        fetchAndCacheAudio(BASE + '/activate.mp3'),
        fetchAndCacheAudio(BASE + '/cancel.mp3'),
        fetchAndCacheAudio(BASE + '/analyzing.mp3')
    ]).catch(e => console.warn('Failed to pre-cache audio files:', e));

    if (!HA_TOKEN || !HA_ASSIST_PIPELINE_NAME) {
        // ... (alert logic as before) ...
        // panelAlert("Configuration incomplete. Please set Token and Pipeline Name.");
        console.error("Configuration incomplete.");
        return;
    }
    console.log("HA Token and Pipeline Name found.");
    try {
        bumblebee = new Bumblebee();
        bumblebee.setWorkersPath('/vendor/bumblebee/workers');
        bumblebee.addHotword('jarvis');
        bumblebee.addHotword('bumblebee');
        bumblebee.setSensitivity(0.5);
        bumblebee.on('hotword', handleHotword);
        console.log("Bumblebee initialized.");
    } catch (error) {
        console.error("Failed to initialize Bumblebee:", error);
        panelAlert("Error initializing hotword engine: " + error.message);
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log("Microphone permission granted.");
    } catch (err) {
        console.error("Microphone permission denied:", err);
        panelAlert('Microphone access is required: ' + err.message);
        return;
    }

    try {
        await connectWebSocket(); // This also attempts VAD initialization on auth_ok
        console.log("HA WebSocket connection established, VAD init process started.");
    } catch (error) {
        console.error("Failed to establish initial HA connection or init VAD:", error);
        panelAlert("Could not connect to Home Assistant or init voice: " + error.message);
        // Allow Bumblebee to start; hotword might trigger successful connection
    }

    if (bumblebee) {
        try {
            await bumblebee.start();
            console.log("Bumblebee listening for hotword.");
        } catch (error) {
            console.error("Failed to start Bumblebee listening:", error);
            panelAlert("Failed to start hotword detection: " + error.message);
        }
    }
    setVAState(STATE.IDLE); // Transition to IDLE if all critical steps passed or are recoverable
    console.log("Application initialized. Current state: IDLE");
}

// --- Event Handlers and Core Logic ---

function resetAll(notify = true) {
    pipelineActive = false;
    resetAudioStreamingState();
    conversationId = newConversationId();
    setVAState(STATE.IDLE);
    if (notify) {
        panelAlert(<h1><center>AI Reset Success</center></h1>, null, 3000);
    }
}

async function handleHotword(hotwordDetails) {
    const hotword = typeof hotwordDetails === 'string' ? hotwordDetails : hotwordDetails.hotword;
    console.log(`Hotword '${hotword}' detected. Current state: ${getStateName(store.vaState)}.`);
    if (hotword === 'bumblebee') {
        resetAll();
        return;
    };

    let oldConvoId = conversationId;
    // reset convo id (prevent state fuckup if SENDING_AUDIO)
    if (store.vaState === STATE.SENDING_AUDIO || (store.vaState === STATE.WAKE_WORD_TRIGGERED && pipelineActive)) {
        conversationId = newConversationId();
    }
    // reset convo id if convo too old
    if (Date.now() - store.voiceLastActiveAt > 300 * 1000) {
        conversationId = newConversationId();
    }
    store.voiceLastActiveAt = Date.now();
    if (conversationId !== oldConvoId || store.vaState === STATE.IDLE) {
        store.lastSTT = '';
        store.lastTTS = '幫緊你幫緊你...';
    }


    // Re-check config
    HA_TOKEN = getHAToken(); HA_ASSIST_PIPELINE_NAME = getHAPipelineName();
    if (!HA_TOKEN || !HA_ASSIST_PIPELINE_NAME) {
        panelAlert("HA Token or Pipeline Name missing. Cannot process hotword.");
        setVAState(STATE.IDLE); // Revert to idle if config is lost
        return;
    }

    if (store.vaState === STATE.PLAYING_TTS) {
        console.log("Hotword detected while TTS playing. Stopping TTS and proceeding.");
        // setState will handle stopping TTS audio when transitioning from PLAYING_TTS
    }

    setVAState(STATE.WAKE_WORD_TRIGGERED, hotwordDetails);
}


function connectWebSocket() {
    return new Promise((resolve, reject) => {
        if (haWebSocket && haWebSocket.readyState === WebSocket.OPEN) {
            console.log("connectWebSocket: Already open.");
            if (!myvad) {
                initializeVAD().then(resolve).catch(err => {
                    console.error("VAD initialization failed on existing open WebSocket:", err);
                    reject(err);
                });
            } else {
                resolve();
            }
            return;
        }
        if (haWebSocket && haWebSocket.readyState === WebSocket.CONNECTING) {
            reject(new Error("WebSocket connection already in progress."));
            return;
        }
        if (!HA_TOKEN) {
            reject(new Error("Home Assistant Token not available for WebSocket."));
            return;
        }

        console.log("Connecting to Home Assistant WebSocket...");
        const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
        haWebSocket = new WebSocket(wsUrl);

        haWebSocket.onopen = () => console.log("WebSocket connection opened.");
        haWebSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'auth_required':
                    console.log("WebSocket: Auth required.");
                    if (HA_TOKEN) {
                        haWebSocket.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
                    } else {
                        console.error("WebSocket: Auth required but HA_TOKEN missing.");
                        haWebSocket.close();
                        reject(new Error('Session token unavailable during auth.'));
                    }
                    break;
                case 'auth_ok':
                    console.log("WebSocket: Authentication successful.");
                    initializeVAD().then(() => {
                        console.log("VAD initialized successfully post-auth.");
                        requestDeviceAndPipelineInfo();
                        resolve();
                    }).catch(vadError => {
                        console.error("VAD initialization failed after auth_ok:", vadError);
                        // Resolve WS connection, but VAD is an issue. App might still work for non-VAD things.
                        // Or reject depending on how critical VAD is for this promise.
                        // For connectWebSocket, successful auth is key. VAD can be re-attempted.
                        resolve();
                        // reject(new Error('VAD initialization failed: ' + vadError.message));
                    });
                    break;
                case 'auth_invalid':
                    console.error("WebSocket: Authentication failed - invalid token.");
                    localStorage.removeItem('ha_token'); HA_TOKEN = null;
                    panelAlert('HA token is invalid. Please provide a new token and refresh.');
                    haWebSocket.close();
                    reject(new Error('WebSocket auth failed: Invalid token.'));
                    break;
                case 'result':
                    if (message.id === currentPipelineRunId && !message.success) {
                        console.error('HA WS: assist_pipeline/run command failed:', message.error);
                        // State change to IDLE will be handled by 'error' event or 'run-end'
                        // but if that doesn't come, this is a fallback issue.
                        // If pipelineActive, and no error event follows, this is a problem.
                        // For now, rely on pipeline events.
                    } // ... other result handling


                    if (message.id === currentPipelineListRequestId) {
                        if (message.success) console.log("VA: Available HA Pipelines:", message.result.pipelines);
                        else console.error("HA WS: Failed to list pipelines:", message.error);
                    } else if (message.id === currentDeviceConfigRequestId) {
                        if (message.success) {
                            console.log("VA: HA Device Config:", message.result);
                            if (message.result.assist_pipeline_preferred) console.log("VA: Preferred pipeline from device config:", message.result.assist_pipeline_preferred);
                        } else console.warn("HA WS: Failed to get device config:", message.error);
                    }

                    break;
                case 'event':
                    handlePipelineEvent(message.event);
                    break;
                case 'pong':
                    break; // console.debug("WS pong received.");
                default:
                    break; // console.debug("WS unhandled message type:", message.type, message);
            }
        };
        haWebSocket.onclose = (evt) => {
            console.log(`WebSocket closed. Code: ${evt.code}, Reason: '${evt.reason}'`);
            const wasPipelineActive = pipelineActive;
            pipelineActive = false;
            resetAudioStreamingState();
            haWebSocket = null;
            if (store.vaState !== STATE.INITIALIZING && store.vaState !== STATE.IDLE) {
                console.log("WebSocket closed, transitioning to IDLE state.");
                if (wasPipelineActive) panelAlert("Connection to Home Assistant lost.");
                setVAState(STATE.IDLE);
            }

            if (navigator.onLine && HA_TOKEN) {
                console.log("Attempting WebSocket auto-reconnect in 5 seconds...");
                setTimeout(() => {
                    if (!haWebSocket) {
                        connectWebSocket().catch(err => console.error('VA: WebSocket auto-reconnect failed:', err.message));
                    }
                }, 5000);
            }
        };
        haWebSocket.onerror = (error) => {
            console.error('WebSocket error event:', error);
            const wasPipelineActive = pipelineActive;
            pipelineActive = false; resetAudioStreamingState();
            // onclose will set haWebSocket to null and handle state transition for active ops
            if (store.vaState !== STATE.INITIALIZING && store.vaState !== STATE.IDLE) {
                // This might be redundant if onclose handles it, but good for clarity
                console.log("WebSocket error, transitioning to IDLE state from onerror.");
                if (wasPipelineActive) panelAlert("Connection error with Home Assistant.");
                // setState(STATE.IDLE); // onclose should also trigger this if needed.
            }
            reject(new Error('WebSocket connection error.'));
        };
    });
}

function initializeVAD() {
    return new Promise(async (resolve, reject) => {
        if (myvad) {
            console.log("VAD instance already exists.");
            resolve(); return;
        }
        console.log("Initializing VAD...");
        try {
            if (typeof vad === 'undefined' || typeof vad.MicVAD === 'undefined') {
                return reject(new Error("VAD library not found."));
            }
            myvad = await vad.MicVAD.new({
                model: 'v5',
                onnxWASMBasePath: '/vendor/ort/',
                baseAssetPath: '/vendor/vad/',
                redemptionFrames: 20,
                onSpeechRealStart: () => {
                    store.vadState = 'onSpeechRealStart';
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                        console.log("VAD: Speech really started.");
                        store.voiceLastActiveAt = Date.now();
                        store.isUserSpeaking = true;
                        if (wakeWordTimeoutId) { // Clear "no speech after wake word" timeout
                            clearTimeout(wakeWordTimeoutId);
                            wakeWordTimeoutId = null;
                        }
                        initiateHAPipelineRun(); // This will set pipelineActive = true on success
                    } else if (store.vaState === STATE.PLAYING_TTS) {

                    } else {
                        console.warn(`VAD: Speech started in unexpected state: ${getStateName(store.vaState)}.`);
                    }
                },
                onSpeechEnd: async (finalAudioBuffer) => { // finalAudioBuffer is the ENTIRE utterance
                    store.vadState = 'onSpeechEnd';
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && pipelineActive) {
                        console.log("VAD: Speech ended.");
                        if (myvad && myvad.listening) {
                            console.log("VAD: Speech ended, pausing VAD for this interaction.");
                            myvad.pause();
                        }

                        // Send the complete utterance. processAndSendAudio will queue it.
                        // sendAudioToHA will send it as one message (or you could adapt it to chunk if HA prefers).
                        // The 'true' flag ensures sendHAStreamEnd is called afterwards.
                        await processAndSendAudio(finalAudioBuffer);
                        setVAState(STATE.SENDING_AUDIO); // Transition: VAD speech done, now waiting for HA
                    } else {
                        console.warn(`VAD: Speech ended, but state (${getStateName(store.vaState)}) or pipelineActive (${pipelineActive}) is not receptive.`);
                        // if (!pipelineActive && store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                        //     // Speech ended, but pipeline never started or failed early.
                        //     panelAlert("Could not process your request.");
                        //     setVAState(STATE.IDLE);
                        // }
                    }
                },
            });
            console.log("VAD initialized successfully.");
            resolve();
        } catch (error) {
            console.error('VA: Error initializing VAD:', error);
            myvad = null;
            reject(error);
        }
    });
}

function sendMessage(message) {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
        console.warn("sendMessage: WebSocket not open."); return -1;
    }
    currentMessageId++;
    const msg = { ...message, id: currentMessageId };
    try {
        haWebSocket.send(JSON.stringify(msg));
        return currentMessageId;
    } catch (error) {
        console.error("sendMessage: Error sending message:", error);
        return -1;
    }
}

function requestDeviceAndPipelineInfo() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) return;
    console.log("Requesting device config and pipeline list from HA.");
    currentDeviceConfigRequestId = sendMessage({ type: "mobile_app/get_config" });
    currentPipelineListRequestId = sendMessage({ type: "assist_pipeline/pipeline/list" });
}
function resetAudioStreamingState() {
    haReadyForAudio = false;
    sttBinaryHandlerId = null;
}

function float32ToInt16(buffer) {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7FFF;
    return buf;
}

function newConversationId() {
    return 'monitor-' + Date.now();
}

async function processAndSendAudio(audio) {
    if (!pipelineActive || !(store.vaState === STATE.WAKE_WORD_TRIGGERED || store.vaState === STATE.SENDING_AUDIO)) {
        if (pipelineActive) console.warn("processAndSendAudio: called while pipelineActive but in incompatible state: " + getStateName(store.vaState));
        // Do not resetAudioStreamingState here if pipelineActive is true, as it might be a brief mismatch.
        return;
    }

    if (haReadyForAudio) {
        await sendAudioToHA(audio);
        sendHAStreamEnd();
    }
}

async function lastSTTAnimation(newText) {
    store.latestText = 0;
    store.lastSTTAnimState = 1;
    await sleep(300);
    store.lastSTTAnimState = 2;
    store.lastSTT = newText;
    await sleep(300);
    store.lastSTTAnimState = 0;
}

async function lastTTSAnimation(newText) {
    store.lastTTSLength = newText.length;
    store.latestText = 1;
    store.lastTTSAnimState = 1;
    await sleep(300);
    store.lastTTSAnimState = 2;
    store.lastTTS = newText;
    await sleep(300);
    store.lastTTSAnimState = 0;
}

function handlePipelineEvent(event) {
    // Should primarily be in SENDING_AUDIO, or WAKE_WORD_TRIGGERED (for run-start after speech started)
    if (!pipelineActive && !(store.vaState === STATE.PLAYING_TTS && event.type === 'tts-end')) { // Allow tts-end if somehow pipeline became inactive before TTS
        console.warn(`Pipeline event '${event.type}' received but pipeline not active or state (${getStateName(store.vaState)}) not expecting it. Data:`, event.data);
        // If it's a critical error, transition to IDLE
        if (event.type === 'error') {
            console.error('VA: HA Pipeline Error Event (unexpected state/pipeline inactive):', event.data.code, event.data.message);
            panelAlert(`Voice assistant error: ${event.data.message}`);
            setVAState(STATE.IDLE);
        }
        return;
    }

    console.log('pipeline', event.type);
    switch (event.type) {
        case 'run-start':
            console.log("Pipeline event: 'run-start'. HA ready for audio.", event.data);
            haReadyForAudio = true; // Indicates HA is ready to start the pipeline stages

            // Capture the stt_binary_handler_id for sending audio
            if (event.data && event.data.runner_data && typeof event.data.runner_data.stt_binary_handler_id === 'number') {
                sttBinaryHandlerId = event.data.runner_data.stt_binary_handler_id;
                console.log(`Pipeline run-start: Using stt_binary_handler_id: ${sttBinaryHandlerId}`);
            } else {
                console.error("Pipeline run-start: stt_binary_handler_id not found or not a number in runner_data. Cannot send audio. Event data:", event.data);
                sttBinaryHandlerId = null; // Critical error, mark as invalid

                // Abort this pipeline attempt as we can't send audio correctly
                pipelineActive = false;
                // currentPipelineRunId remains, but HA will likely timeout.
                setVAState(STATE.IDLE); // Go back to idle
                panelAlert("Voice assistant configuration error from server. Please try again.");
                return; // Stop processing this event further for this case
            }
            // Any pre-buffered audio logic would go here if you were chunking before run-start
            break;
        case 'stt-end':
            console.log("Pipeline event: 'stt-end'.", event);
            lastSTTAnimation(event.data.stt_output.text.trim());
            break;
        case 'tts-start':
            console.log("Pipeline event: 'tts-start'", event.data);
            let ttsText = event.data.tts_input.trim();
            if (ttsText.includes('Provider')) {
                // error
                setVAState(STATE.IDLE); // Go back to idle
                panelAlert("AI Error. Please try again.");
                console.log(ttsText);
                return;
            }
            if (ttsText.includes(EXIT_MAGIC)) { setVAState(STATE.IDLE); return; }
            if (ttsText.includes(REFRESH_MAGIC)) { location.reload(); return; }
            if (ttsText.includes(VOLUME_MAGIC)) {
                const volumeMatch = ttsText.match(new RegExp(`${VOLUME_MAGIC}\\s*([+-]?\\d+)?`));
                if (volumeMatch && volumeMatch[1] !== undefined) {
                    setVolume(volumeMatch[1]);
                } else if (ttsText.includes(`${VOLUME_MAGIC} +`)) {
                    setVolume('+10');
                } else if (ttsText.includes(`${VOLUME_MAGIC} -`)) {
                    setVolume('-10');
                }
                resetAll(false);
                return;
            }
            lastTTSAnimation(ttsText);
            break;
        case 'tts-end':
            console.log("Pipeline event: 'tts-end'. TTS Output URL:", event.data.tts_output ? event.data.tts_output.url : "N/A");
            if (event.data.tts_output && event.data.tts_output.url) {
                const ttsUrl = (event.data.tts_output.url.startsWith('http') ? '' : HA_URL) + event.data.tts_output.url;
                if (store.vaState === STATE.SENDING_AUDIO || store.vaState === STATE.WAKE_WORD_TRIGGERED) { // Expecting TTS from these states
                    setVAState(STATE.PLAYING_TTS, ttsUrl);
                } else {
                    // console.warn(`TTS-END event received but not in SENDING_AUDIO/WAKE_WORD_TRIGGERED. State: ${getStateName(store.vaState)}. Playing TTS anyway.`);
                    // new Audio(ttsUrl).play().catch(e => console.error('Error playing TTS audio (fallback):', e));
                    // if (store.vaState !== STATE.IDLE && store.vaState !== STATE.PLAYING_TTS) { setVAState(STATE.IDLE); }
                }
            } else { // No TTS output, but tts stage / intent handling is done. If no run-end follows, this might be the end.
                console.log("TTS-END event with no TTS output URL. If no further events, pipeline might be considered ended.");
                // If 'run-end' is not guaranteed, we might need to transition to IDLE here.
                // For now, assuming 'run-end' is the definitive signal.
            }
            break;
        case 'run-end':
            console.log("Pipeline event: 'run-end'. Pipeline finished.");
            pipelineActive = false;
            currentPipelineRunId = null;
            resetAudioStreamingState();
            // If we were playing TTS, onended will handle IDLE. Otherwise, if we were sending, go IDLE.
            if (store.vaState === STATE.SENDING_AUDIO || store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                setVAState(STATE.IDLE);
            } else if (store.vaState === STATE.PLAYING_TTS) {
                // TTS is playing, its onended will transition to IDLE. Run-end just confirms HA side is done.
                console.log("Run-end received while TTS playing. TTS onended will manage transition to IDLE.");
            } else {
                console.log(`Run-end received in state ${getStateName(store.vaState)}. Forcing IDLE.`);
                setVAState(STATE.IDLE);
            }
            break;
        case 'error':
            console.error('VA: HA Pipeline Error Event:', event.data.code, event.data.message);
            panelAlert(`Voice assistant error: ${event.data.message} (Code: ${event.data.code})`);
            pipelineActive = false;
            currentPipelineRunId = null;
            resetAudioStreamingState();
            setVAState(STATE.IDLE);
            break;
        default:
            break;
    }
}
async function sendAudioToHA(audioBuffer) {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN || !pipelineActive || !haReadyForAudio) {
        console.warn("sendAudioToHA: Conditions not met for sending audio.");
        return;
    }
    if (sttBinaryHandlerId === null) {
        console.error("sendAudioToHA: stt_binary_handler_id is not set. Cannot send audio.");
        pipelineActive = false; // Stop this attempt
        resetAudioStreamingState(); // Clean up
        setVAState(STATE.IDLE);
        panelAlert("Error sending audio: missing handler ID.");
        return;
    }

    const int16Audio = float32ToInt16(audioBuffer);
    const audioBytes = int16Audio.buffer;
    const handlerByte = sttBinaryHandlerId; // Use the dynamic handler ID
    const prefixedBuffer = new ArrayBuffer(1 + audioBytes.byteLength);
    const view = new DataView(prefixedBuffer);
    view.setUint8(0, handlerByte);
    new Uint8Array(prefixedBuffer, 1).set(new Uint8Array(audioBytes));
    try {
        haWebSocket.send(prefixedBuffer);
    } catch (error) {
        console.error("sendAudioToHA: Error sending audio data:", error);
        pipelineActive = false; resetAudioStreamingState(); setVAState(STATE.IDLE);
    }
}

function sendHAStreamEnd() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN || !pipelineActive) { // Removed !haReadyForAudio here, as it might be false after sending last chunk
        console.warn("sendHAStreamEnd: Conditions not met for sending stream end (WS closed or pipeline inactive).");
        return;
    }
    if (sttBinaryHandlerId === null) {
        console.error("sendHAStreamEnd: stt_binary_handler_id is not set. Cannot reliable send stream end.");
        // Depending on strictness, you might still try with a default or just log
        // For robustness, if it's null, this operation is also compromised.
        // However, sendHAStreamEnd is called after all audio, so HA might figure it out by timeout eventually.
        // Let's be strict for now:
        pipelineActive = false; // Stop this attempt
        resetAudioStreamingState(); // Clean up technically already done if audio send failed
        setVAState(STATE.IDLE);
        panelAlert("Error ending audio stream: missing handler ID.");
        return;
    }

    const handlerByte = sttBinaryHandlerId; // Use the dynamic handler ID
    const endMarker = new Uint8Array([handlerByte]);
    try {
        haWebSocket.send(endMarker.buffer);
        console.log("Sent stream end signal to HA using handler ID:", handlerByte);
        haReadyForAudio = false; // No more audio for THIS run after end signal.
    } catch (error) {
        console.error("sendHAStreamEnd: Error sending stream end signal:", error);
        pipelineActive = false; resetAudioStreamingState(); setVAState(STATE.IDLE);
    }
}


function initiateHAPipelineRun() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
        console.warn("Cannot initiate HA pipeline: WebSocket not open.");
        panelAlert("Not connected to Home Assistant.");
        setVAState(STATE.IDLE); return;
    }
    if (pipelineActive) { // Should not happen if state logic is correct
        console.warn("Cannot initiate HA pipeline: another pipeline is already active.");
        return;
    }
    if (store.vaState !== STATE.WAKE_WORD_TRIGGERED) {
        console.warn(`initiateHAPipelineRun called in incorrect state: ${getStateName(store.vaState)}. Aborting.`);
        return;
    }
    if (!HA_ASSIST_PIPELINE_NAME) {
        console.error("Cannot initiate HA pipeline: HA_ASSIST_PIPELINE_NAME is not configured.");
        panelAlert("HA Assist Pipeline Name is not configured.");
        setVAState(STATE.IDLE); return;
    }

    console.log(`Initiating HA Assist Pipeline: ${HA_ASSIST_PIPELINE_NAME}`);
    resetAudioStreamingState(); // Prepare for new audio stream

    currentPipelineRunId = sendMessage({
        type: 'assist_pipeline/run',
        start_stage: 'stt',
        end_stage: 'tts',
        input: { sample_rate: 16000 }, // Ensure VAD outputs this rate
        pipeline: HA_ASSIST_PIPELINE_NAME,
        conversation_id: conversationId,
    });

    if (currentPipelineRunId === -1) {
        console.error("Failed to send assist_pipeline/run message.");
        pipelineActive = false; // Ensure it's false
        panelAlert("Failed to start voice command with Home Assistant.");
        setVAState(STATE.IDLE);
    } else {
        console.log(`Pipeline run initiated with ID: ${currentPipelineRunId}.`);
        pipelineActive = true; // Successfully initiated HA communication
        // State remains WAKE_WORD_TRIGGERED. Transitions to SENDING_AUDIO on VAD's onSpeechEnd.
    }
}


// Start the application
initializeApp().catch(initializationError => {
    console.error("Critical error during application initialization:", initializationError);
    panelAlert("Application failed to initialize: " + initializationError.message);
    // Ensure state reflects this failure if not already handled
    if (store.vaState === STATE.INITIALIZING || store.vaState === STATE.IDLE) {
        // Could define a STATE.ERROR or just leave it as non-functional IDLE
        // For now, alerts are shown. User must refresh or fix config.
    }
});

// Watchdog timer
setInterval(() => {
    let now = Date.now();
    if (now - store.uiPollingTimestamp > RELAX_BUFFER_MS && now - store.lastDataPushedAt > RELAX_BUFFER_MS * 3) {
        store.uiPollingTimestamp = now;
        console.log('store.uiPollingTimestamp = now', 'setInterval');
    }
    if (!store.mainUI) {
        store.mainUI = document.querySelector("html");
    }
}, 1000);

document.querySelector("body").addEventListener('click', (e) => {
    document.querySelector("body").requestFullscreen();
    store.lastInteract = Date.now();
});

document.querySelector("body").addEventListener('touchstart', (e) => {
    store.lastInteract = Date.now();
});
