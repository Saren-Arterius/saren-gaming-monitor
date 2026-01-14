const SMALL_WIDTH = 540;
const SMALL_HEIGHT = 420;
const POWERSAVE_MS = 60000;
const RELAX_BUFFER_MS = 995;
const WAKE_WORD_SPEECH_TIMEOUT = 7000;
const HA_URL = "https://" + location.host.replace("monitor-", "ha-");
const EXIT_MAGIC = "XXEXITXX";
const BASE = '';
const REFRESH_MAGIC = "XXREFRESHXX";
const NIGHT_H = 22;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COLOR_STOPS = [
    { color: "#70CAD1", position: 0 },
    { color: "#F7EE7F", position: 50 },
    { color: "#A63D40", position: 100 }
];

// State definitions
const STATE = {
    INITIALIZING: 0,
    IDLE: 1,
    WAKE_WORD_TRIGGERED: 2, // Waiting for VAD speech start/end or timeout
    SENDING_AUDIO: 3, // VAD onSpeechEnd called, sending to HA, waiting for HA response
    PLAYING_TTS: 4
};

const STORAGE_TEXT_COLOR = [null, COLOR_STOPS[1].color, COLOR_STOPS[2].color];
const STORAGE_EXTRA_TEXT = [null, " ⚠️", " ⛔️"];

// const { DotLottieReact } = dotlottie;
const { useEffect, useState, useRef } = React;
const { makeAutoObservable, autorun, reaction } = mobx;
const { Observer, observer } = mobxReactLite;
// const { Circle, Cpu, Activity } = require('react-feather');

const modalOverlayStyle = {
    display: "flex",
    width: "100%",
    height: "100%",
    position: "fixed",
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px) brightness(0.4)",
    backgroundColor: "rgba(0,0,0,0.6)",
    top: 0,
    left: 0,
    transition: "opacity 0.3s ease-in-out",
    opacity: 0
};

const modalContainerStyle = {
    backgroundColor: "rgba(255,255,255,0.05)",

    // backgroundColor: "#111",
    width: "90%",
    maxWidth: 800,
    maxHeight: "90vh",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
};

const modalHeaderStyle = {
    padding: 20,
    borderBottom: "1px solid #333",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    // backgroundColor: "#1a1a1a"
};

const Modal = ({ title, onClose, children, style }) => (
    <div
        style={{ ...modalOverlayStyle, ...style }}
        onClick={(e) => {
            // console.log('store.lastInteract = Date.now();')
            store.lastInteract = Date.now();
            onClose(e);
        }}
    >
        <div
            className="container"
            style={modalContainerStyle}
            onClick={(e) => {
                // console.log('store.lastInteract = Date.now();')
                store.lastInteract = Date.now();
                e.stopPropagation();
            }}
        >
            <div style={modalHeaderStyle}>
                <div style={{ fontSize: "1.2em", fontWeight: 600 }}>{title}</div>
                <div style={{ cursor: "pointer", padding: 5, fontSize: "1.2em" }} onClick={onClose}>
                    ✕
                </div>
            </div>
            <div style={{ overflowY: "auto", padding: 20, height: '100vh' }}>{children}</div>
        </div>
    </div>
);

const useModalTransition = (isOpen) => {
    const [mounted, setMounted] = useState(isOpen);
    const [opacity, setOpacity] = useState(isOpen ? 1 : 0);
    useEffect(() => {
        if (isOpen) {
            setMounted(true);
            requestAnimationFrame(() => requestAnimationFrame(() => setOpacity(1)));
        } else {
            setOpacity(0);
            const timer = setTimeout(() => {
                setMounted(false);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    return {
        shouldRender: mounted,
        style: { opacity, pointerEvents: isOpen ? "auto" : "none" }
    };
};

class Store {
    livingRoomLux = 100;
    livingRoomOccupied = true;
    bgImage = null;

    get livingRoomInfo() {
        return {
            lux: this.livingRoomLux,
            occupied: this.livingRoomOccupied,
        };
    }

    get bgBrightness() {
        const { lux } = this.livingRoomInfo;
        return lux <= 1 ? 0 : 1;
    }

    // Configuration Constants
    SYSTEM_INFO = {
        hostname: "PC",
        cpu: "AMD",
        gpu: "Nvidia",
        case: "PC Case",
        os: "Linux"
    };

    GAUGE_LIMITS = {
        temperature: {
            cpu: { min: 30, max: 95 },
            gpu: { min: 30, max: 80 }
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
            ssd: { max: 2200 },
            motherboard: { max: 12000 }
        }
    };

    alertMessage = null;
    alertExpire = 0;
    windowWidth = window.innerWidth;
    windowHeight = window.innerHeight;

    storageInfo = {};
    temperatures = {
        cpu: 30,
        gpu: 50
    };
    usage = {
        cpu: 34,
        gpu: 50,
        ram: 35,
        vram: 35
    };
    usageMB = {
        ram: 16384,
        vram: 10240
    };
    disks = {};
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
        routeMetrics: {}
    };
    fanSpeed = {
        cpu: 1500,
        motherboard: 2100
    };
    frequencies = {
        cpu: [0],
        gpuCore: 0
    };
    pwr = {
        gpu: 0
    };

    firstDataPushedAt = 0;
    lastDataPushedAt = 0;

    lastUpdate = 0; // server's timestamp
    _uiPollingTimestamp = 0;
    voiceLastActiveAt = 0;
    vaState = STATE.INITIALIZING;
    isUserSpeaking = false;
    lastSTT = "";
    lastSTTAnimState = 0; // 1 = fading out, 2 = changing pos, 0 = fading in or stable;
    lastTTSLength = 0;
    lastTTS = "";
    lastTTSAnimState = 0; // 1 = fading out, 2 = changing pos, 0 = fading in or stable;
    latestText = 0; // 0 = lastSTT, 1 = lastTTS

    mainUI = null;
    _lastInteract = Date.now();

    initInfo = null;
    networkMetrics = null;
    iotMetrics = [];
    internetMetrics = [];
    showNetworkModal = false;
    storageModalTarget = null; // 'system' | 'storage' | null
    iotExpandedDevices = {};

    set vaState(value) {
        this._vaState = value;
        this.lastInteract = Date.now(); // Update lastInteract when vaState changes
    }

    get vaState() {
        return this._vaState;
    }

    set uiPollingTimestamp(value) {
        this._uiPollingTimestamp = value;
    }

    get uiPollingTimestamp() {
        return this._uiPollingTimestamp;
    }

    set lastInteract(value) {
        this._lastInteract = value;
    }

    get lastInteract() {
        return this._lastInteract;
    }

    get mainUIBrightness() {
        const timeSinceLastInteract = (Math.max(this.uiPollingTimestamp, Date.now()) - this.lastInteract) / 1000;

        // 1. If interaction is recent (<= 30s), keep brightness at 1
        // regardless of occupancy status change (Condition 4)
        if (timeSinceLastInteract <= 30) return 1;

        const { occupied, lux } = this.livingRoomInfo;

        // 2. If not occupied and timed out (> 30s), fade to 0 (Condition 5 & 3)
        if (!occupied) return 0;

        // 3. Occupied logic
        const currentHour = new Date().getHours();
        const isNight = lux <= 1 || currentHour >= NIGHT_H || currentHour < 6;

        if (!isNight) return 1;

        // 4. Night mode with occupancy: fade logic from 1 to 0.3 between 30s and 90s
        if (timeSinceLastInteract > 90) return 0.3;

        return 1 - ((timeSinceLastInteract - 30) / 60) * 0.7;
    }

    updateBrightness() {
        console.log('updateBrightness');
        if (this.bgImage) {
            if (this.bgImage.style.transition !== 'filter 1s linear') {
                this.bgImage.style.transition = 'filter 1s linear';
            }
            this.bgImage.style.filter = `brightness(${this.bgBrightness})`;
        }

        if (this.mainUI) {
            if (this.mainUI.style.transition !== 'filter 1s linear') {
                this.mainUI.style.transition = 'filter 1s linear';
            }
            this.mainUI.style.filter = `brightness(${this.mainUIBrightness})`;
        }
    }

    constructor() {
        makeAutoObservable(this);
    }
}

const store = new Store();

reaction(
    () => store.lastInteract,
    (lastInteract) => {
        console.log("store.lastInteract updated:", lastInteract);
    }
);

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

function hexToRGB(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

function rgbToHex(r, g, b) {
    return (
        "#" +
        [r, g, b]
            .map((x) => {
                const hex = x.toString(16);
                return hex.length === 1 ? "0" + hex : hex;
            })
            .join("")
    );
}

function formatBytes(bytes, decimals = 1, name = "B", space = true) {
    if (bytes === 0) return `0 ${name}`;

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const formattedValue = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    const unit = sizes[i];
    return space ? `${formattedValue} ${unit}${name}` : `${formattedValue}${unit}${name}`;
}

function getGMT8Time(t) {
    const now = new Date(t);
    now.setHours(now.getHours()); // Assuming pre-adjusted or local
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const Gauge = ({
    value,
    valueMB,
    valueGB,
    min = 0,
    max,
    label,
    className,
    featherName,
    small,
    cpuFreq,
    gpuFreq,
    gpuPwr,
    clickFn,
    textColor,
    textExtra,
    labelExtra
}) => {
    useEffect(() => {
        feather.replace();
    }, []);

    let pct = ((value - min) / (max - min)) * 75;
    if (pct > 75) pct = 75;
    let iconColor = getColorAtPercent(pct / 0.75);
    let valueExtra = { usage: "%", temperature: "°C" }[className] || "";
    if (className === "io") value = formatBytes(value) + "/s";

    let gaugeSize = small ? 120 : undefined;
    let featherTop = small ? 40 : undefined;
    let featherSize = undefined;
    let gaugeValueMT = undefined;
    let ioTransformLabelMarginTop = undefined;
    let ioTransform = "scale(0.8)";
    let isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;
    if (isSmallScreen) {
        gaugeSize = small ? 60 : 80;
        featherTop = small ? 20 : 30;
        featherSize = small ? 20 : 24;
        gaugeValueMT = small ? 45 : 60;
        ioTransformLabelMarginTop = -10;
        ioTransform = "scale(0.5)";
    }
    let labelExtras =
        (valueMB ? `${valueMB} MB` : "") +
        (valueGB ? `${valueGB} GB` : "") +
        (cpuFreq
            ? `${Math.round(Math.min(...store.frequencies.cpu))}-${Math.round(Math.max(...store.frequencies.cpu))} MHz`
            : "") +
        (gpuFreq ? `${store.frequencies.gpuCore} MHz` : "") +
        (gpuPwr ? `${store.pwr.gpu} W` : "") +
        (labelExtra || "");
    return (
        <div
            className="gauge"
            style={{
                width: gaugeSize,
                height: gaugeSize,
                cursor: clickFn ? "pointer" : undefined,
                transform: clickFn ? "scale(1)" : undefined,
                transition: clickFn ? "transform 0.2s ease-in-out, filter 0.2s ease-in-out" : undefined
            }}
            onMouseEnter={
                window.matchMedia("(hover: hover) and (pointer: fine)").matches && clickFn
                    ? (e) => {
                        e.currentTarget.style.transform = "scale(1.1)";
                        e.currentTarget.style.filter = "brightness(1.2)";
                    }
                    : undefined
            }
            onMouseLeave={
                window.matchMedia("(hover: hover) and (pointer: fine)").matches && clickFn
                    ? (e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.filter = "brightness(1)";
                    }
                    : undefined
            }
            onTouchStart={
                clickFn
                    ? (e) => {
                        e.currentTarget.style.transform = "scale(1.1)";
                        e.currentTarget.style.filter = "brightness(1.2)";
                    }
                    : undefined
            }
            onTouchEnd={
                clickFn
                    ? (e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.filter = "brightness(1)";
                    }
                    : undefined
            }
            onClick={() => clickFn && clickFn()}
        >
            <div className="gauge-body">
                <div>
                    <div className="gauge-fill"></div>
                    <div className="gauge-cover"></div>
                    <div className="gauge-cover-2" style={{ "--a": `${pct}%` }}></div>
                    <div className="gauge-cover-outer">
                        <div className="feather-wrapper" style={{ color: `${iconColor}`, top: featherTop }}>
                            <i data-feather={featherName} style={{ width: featherSize, height: featherSize }}></i>
                        </div>
                        <div
                            className="gauge-value"
                            style={{
                                transform: className === "io" ? ioTransform : undefined,
                                marginTop: gaugeValueMT,
                                color: textColor || undefined
                            }}
                        >
                            {value}
                            {valueExtra}
                            {textExtra || ""}
                        </div>
                        <div
                            className="gauge-label"
                            style={{
                                marginTop: className === "io" ? ioTransformLabelMarginTop : undefined
                            }}
                        >
                            {label}
                            {!isSmallScreen && labelExtras ? " / " + labelExtras : ""}
                        </div>
                        {isSmallScreen && <div className="gauge-label">{labelExtras}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const shouldPowerSave = () => {
    if (store.showNetworkModal || store.storageModalTarget) return false;
    return Date.now() - store.lastInteract > POWERSAVE_MS;
};

const exitPowerSaveIfNeeded = () => {
    let now = Date.now();
    if (now - store.lastInteract <= POWERSAVE_MS) {
        if (now - store.lastInteract > RELAX_BUFFER_MS) store.lastInteract = now;
        return;
    }
    store.lastInteract = now;
};

// Extracted Component: Full Screen Status (AI, Connecting, Error)
const FullScreenStatus = observer(() => {
    const lastContentRef = useRef(null);
    let content = null;
    let shouldShow = false;

    if (store.lastUpdate === 0) {
        shouldShow = true;
        content = (
            <div style={fullScreenOverlayStyle}>
                <div style={{ fontSize: "4em" }}>🌐</div>
                <div style={{ fontSize: "3em" }}>Connecting...</div>
            </div>
        );
    } else if (store.uiPollingTimestamp - store.firstDataPushedAt < 200) {
        shouldShow = true;
        content = (
            <div style={fullScreenOverlayStyle}>
                <div style={{ fontSize: "4em" }}>🌐</div>
                <div style={{ fontSize: "3em" }}>Connected</div>
            </div>
        );
    } else if (store.vaState >= 2) {
        shouldShow = true;
        exitPowerSaveIfNeeded();
        let filter = "";
        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) filter = store.isUserSpeaking ? "" : "saturate(0.3) opacity(0.3)";
        else if (store.vaState === STATE.SENDING_AUDIO) filter = "opacity(0.5)";

        let stateToTransform = (num) =>
            num === 1 ? "translateY(-20px)" : num === 2 ? "translateY(20px)" : "translateY(0px)";
        let stateToOpacity = (num, opacity = 1) => (num === 1 || num === 2 ? 0 : opacity);

        content = (
            <div
                style={fullScreenOverlayStyle}
                onClick={() => {
                    if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                    else if (store.vaState === STATE.WAKE_WORD_TRIGGERED && !store.isUserSpeaking) {
                        pipelineActive = false;
                        resetAudioStreamingState();
                        setVAState(STATE.IDLE);
                    }
                }}
            >
                <dotlottie-player
                    src="/vendor/ai.lottie"
                    background="transparent"
                    speed={0.5}
                    style={{ width: "400px", height: "400px", filter }}
                    loop
                    autoplay
                />
                <div
                    style={{
                        position: "absolute",
                        textAlign: "center",
                        width: "90%",
                        height: "80%"
                    }}
                >
                    <div style={{ position: "absolute", top: "0", width: "100%" }}>
                        <div
                            style={{
                                fontSize: "2em",
                                transition: "all 0.3s ease-in-out",
                                lineHeight: "1.3em",
                                width: "100%",
                                transform: stateToTransform(store.lastSTTAnimState),
                                opacity: stateToOpacity(store.lastSTTAnimState, store.latestText === 0 ? 1 : 0.5)
                            }}
                        >
                            {store.lastSTT}
                        </div>
                    </div>
                    <div style={{ position: "absolute", bottom: "0", width: "100%" }}>
                        <div
                            style={{
                                fontSize: "2em",
                                transition: "all 0.3s ease-in-out",
                                lineHeight: "1.3em",
                                width: "100%",
                                transform: stateToTransform(store.lastTTSAnimState),
                                opacity: stateToOpacity(store.lastTTSAnimState, store.latestText === 1 ? 1 : 0.5)
                            }}
                        >
                            {store.lastTTS}
                        </div>
                    </div>
                </div>
            </div >
        );
    } else {
        let isTimeout = store.lastUpdate > 0 && Math.max(store.uiPollingTimestamp, Date.now()) - store.lastUpdate > 5000;
        if (isTimeout) {
            shouldShow = true;
            exitPowerSaveIfNeeded();
            content = (
                <div style={fullScreenOverlayStyle}>
                    <div style={{ fontSize: "4em" }}>⚠️</div>
                    <div style={{ fontSize: "3em" }}>Connection Lost</div>
                    <div style={{ fontSize: "1em" }}>{formatTimeDiff(store.lastUpdate)}</div>
                </div>
            );
        }
    }

    const { shouldRender, style } = useModalTransition(shouldShow);

    if (shouldShow && content) {
        lastContentRef.current = content;
    }

    if (!shouldShow && shouldRender && lastContentRef.current) {
        content = lastContentRef.current;
    }

    if (!shouldRender || !content) return null;

    return React.cloneElement(content, { style: { ...content.props.style, ...style } });
});

const fullScreenOverlayStyle = {
    position: "fixed",
    width: "100%",
    height: "100%",
    backgroundColor: "#232323a0",
    backdropFilter: "blur(4px) brightness(0.65)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    top: 0,
    left: 0,
    transition: "opacity 0.3s ease-in-out"
};

const StorageModal = observer(() => {
    const section = store.storageModalTarget;
    const { shouldRender, style } = useModalTransition(!!section);

    if (!shouldRender) return null;

    const tabStyle = (isActive) => ({
        padding: "10px 15px",
        cursor: "pointer",
        borderBottom: isActive ? "2px solid #70CAD1" : "2px solid transparent",
        color: isActive ? "#70CAD1" : "#aaa",
        fontWeight: isActive ? "600" : "400",
        transition: "all 0.2s ease"
    });

    const disks = Object.values(store.disks);

    return (
        <Modal
            title={
                <div style={{ display: "flex", borderBottom: "1px solid #333", marginBottom: -21, marginTop: -20, marginLeft: -20 }}>
                    {disks.map((disk) => (
                        <div
                            key={disk.label}
                            style={tabStyle(section === disk.label)}
                            onClick={() => (store.storageModalTarget = disk.label)}
                        >
                            {disk.name}
                        </div>
                    ))}
                </div>
            }
            onClose={() => (store.storageModalTarget = null)}
            style={style}
        >
            <StorageHeader section={section} />
            <StorageContent target={section} />
            <div style={{ opacity: 0.6, fontSize: "0.8em", textAlign: "right", position: "fixed", bottom: "1em", marginLeft: "-1.5em" }}>
                Last updated: {store.storageInfo[section] ? formatTimeDiff(store.storageInfo[section].lastUpdate) : "N/A"}
            </div>
        </Modal>
    );
});

const StorageHeader = observer(({ section }) => {
    useEffect(() => {
        feather.replace();
    }, [section]);

    const data = store.storageInfo[section];
    if (!data || !data.info) return null;

    const info = data.info;
    const status = info.status || 0;
    const statusColor = STORAGE_TEXT_COLOR[status] || getColorAtPercent(0);
    const isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;

    return (
        <div
            style={{
                marginBottom: 15,
                // backgroundColor: "rgb(26, 26, 26)",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                padding: 15,
                display: "flex",
                flexDirection: isSmallScreen ? "column" : "row",
                gap: isSmallScreen ? 15 : 20
            }}
        >
            <div style={{ flex: 1, borderBottom: isSmallScreen ? '1px solid #333' : 'none', borderRight: isSmallScreen ? 'none' : '1px solid #333', paddingRight: isSmallScreen ? 0 : 15, paddingBottom: isSmallScreen ? 15 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <i data-feather="activity" style={{ width: 14, height: 14, color: statusColor, opacity: 0.8 }}></i>
                    <span style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
                </div>
                <div style={{ fontSize: '1.2em', fontWeight: 700, color: statusColor, fontFamily: 'monospace' }}>{info.statusText}</div>
            </div>
            <div style={{ flex: 1, borderBottom: isSmallScreen ? '1px solid #333' : 'none', borderRight: isSmallScreen ? 'none' : '1px solid #333', paddingRight: isSmallScreen ? 0 : 15, paddingBottom: isSmallScreen ? 15 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <i data-feather="alert-triangle" style={{ width: 14, height: 14, color: statusColor }}></i>
                    <span style={{ fontSize: "0.8em", fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent Issues</span>
                </div>
                {info.issues.length === 0 ? (
                    <div style={{ color: getColorAtPercent(0), fontSize: "0.85em", fontWeight: 500 }}>
                        All systems operational
                    </div>
                ) : (
                    <div style={{ maxHeight: 80, overflowY: 'auto', paddingRight: 5 }}>
                        {info.issues.map((issue, i) => (
                            <div key={i} style={{
                                fontSize: "0.85em",
                                marginBottom: 6,
                                color: statusColor,
                                fontFamily: 'monospace'
                            }}>
                                • {issue}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, paddingLeft: isSmallScreen ? 0 : 5 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <i data-feather="database" style={{ width: 14, height: 14, color: '#eee', opacity: 0.6 }}></i>
                        <span style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mount Points</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {data.paths.map((path, idx) => (
                            <span key={idx} style={{
                                fontSize: '0.85em',
                                color: '#eee',
                                fontFamily: 'monospace',
                                fontWeight: 500
                            }}>
                                {path}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
});

const StorageContent = observer(({ target }) => {
    if (!target) return null;
    const data = store.storageInfo[target];

    if (!data || !data.paths)
        return <div style={{ padding: 20 }}>No data.</div>;

    const info = data.info;
    const smart = info.metrics.smart;
    const fs = info.metrics.filesystem;

    const tdStyle = { padding: 8, opacity: 0.8, width: "100%" };
    const tdRightStyle = { textAlign: "right" };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3
                style={{
                    borderBottom: "1px solid #444",
                    paddingBottom: 5,
                    marginTop: 15
                }}
            >
                Drive Health
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                    <tr>
                        <td style={tdStyle}>Spare blocks</td>
                        <td style={tdRightStyle}>{smart.spare.formatted}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Wear level</td>
                        <td style={tdRightStyle}>{smart.wear.formatted}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Media errors</td>
                        <td style={tdRightStyle}>{smart.mediaErrors.formatted}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Age</td>
                        <td style={tdRightStyle}>{smart.powerOnTime.formatted}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Total written</td>
                        <td style={tdRightStyle}>{smart.dataWritten.formatted}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Total read</td>
                        <td style={tdRightStyle}>{smart.dataRead.formatted}</td>
                    </tr>
                </tbody>
            </table>

            <h3
                style={{
                    borderBottom: "1px solid #444",
                    paddingBottom: 5,
                    marginTop: 15
                }}
            >
                BTRFS Status
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                    <tr>
                        <td style={tdStyle}>Write errors</td>
                        <td style={tdRightStyle}>{fs.writeErrors}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Read errors</td>
                        <td style={tdRightStyle}>{fs.readErrors}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Flush errors</td>
                        <td style={tdRightStyle}>{fs.flushErrors}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Corruption errors</td>
                        <td style={tdRightStyle}>{fs.corruptionErrors}</td>
                    </tr>
                    <tr>
                        <td style={tdStyle}>Generation errors</td>
                        <td style={tdRightStyle}>{fs.generationErrors}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
});

const NetworkModal = observer(() => {
    const { shouldRender, style } = useModalTransition(store.showNetworkModal);

    const [activeTab, setActiveTab] = useState(0); // 0: Traffic, 1: IoT, 2: Internet

    if (!shouldRender) return null;

    const tabStyle = (isActive) => ({
        padding: "10px 15px",
        cursor: "pointer",
        borderBottom: isActive ? "2px solid #70CAD1" : "2px solid transparent",
        color: isActive ? "#70CAD1" : "#aaa",
        fontWeight: isActive ? "600" : "400",
        transition: "all 0.2s ease"
    });

    const closeAll = () => {
        store.showNetworkModal = false;
    };

    const lastUpdated = store.networkMetrics?.last_updated;

    return (
        <Modal
            title={
                <div style={{ display: "flex", borderBottom: "1px solid #333", marginBottom: -21, marginTop: -20, marginLeft: -20 }}>
                    <div style={tabStyle(activeTab === 0)} onClick={() => setActiveTab(0)}>Gateway</div>
                    <div style={tabStyle(activeTab === 2)} onClick={() => setActiveTab(2)}>Web</div>
                    <div style={tabStyle(activeTab === 1)} onClick={() => setActiveTab(1)}>IoT</div>
                </div>
            }
            onClose={closeAll}
            style={style}
        >
            {activeTab === 0 && <NetworkContent />}
            {activeTab === 1 && <IoTContent />}
            {activeTab === 2 && <InternetContent />}
            <div style={{ opacity: 0.6, fontSize: "0.8em", textAlign: "right", position: 'fixed', bottom: '1em', marginLeft: '-1.5em' }}>
                Last updated: {formatTimeDiff(lastUpdated)}
            </div>
            <div style={{ display: 'none' }}>{store.lastDataPushedAt}</div>
        </Modal>
    );
});

const iotPingColor = (pAvg, pLoss) =>
    getColorAtPercent(Math.min(100, Math.max((pAvg || 0) ** 1.5 / 50, pLoss || 0)));

const NetworkContent = observer(() => {
    useEffect(() => {
        feather.replace();
    }, []);

    const pingMetrics = store.networkMetrics.ping_statistics;
    const trafficMetrics = store.networkMetrics.network_traffic;
    const formatShort = (date) =>
        new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        })
            .format(date)
            .replace(/, (\d+):/, ", $1:");

    // Process chart data
    const periods = ["1m", "5m", "15m", "1h", "3h", "12h", "24h", "3d", "7d", "30d"];
    const trafficRows = periods
        .map((p) => {
            const d = trafficMetrics.historical["last" + p];
            if (!d) return null;
            return {
                p,
                rxAvg: formatBytes(d.avg_rx_Bps, 1, "B/s"),
                rxTot: formatBytes(d.cum_rx, 1, "B", true),
                txAvg: formatBytes(d.avg_tx_Bps, 1, "B/s"),
                txTot: formatBytes(d.cum_tx, 1, "B", true)
            };
        })
        .filter((x) => x);

    const pingPeriods = [
        { l: "Now", k: "latest" },
        { l: "1m", k: "last1m" },
        { l: "5m", k: "last5m" },
        { l: "1h", k: "last1h" },
        { l: "24h", k: "last24h" }
    ];

    const thStyle = {
        padding: "8px",
        textAlign: "left",
        borderBottom: "1px solid #444",
        fontSize: "0.9em",
        color: "#000",
        opacity: 0.7
    };
    const tdStyle = { padding: "8px", borderBottom: "1px solid #222" };
    const numStyle = { ...tdStyle, textAlign: "right" };

    let outageColor = getColorAtPercent(0);
    let durationSecondsSum = 0;

    if (pingMetrics.outages.length > 0) {
        durationSecondsSum = pingMetrics.outages.reduce((sum, o) => sum + o.duration_seconds, 0);
        const extraPercent = Math.min(50, (durationSecondsSum / 300) * 100);
        outageColor = getColorAtPercent(50 + extraPercent);
    }

    const isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;

    return (
        <div style={{ display: "flex", flexDirection: "column" }}>
            <div
                style={{
                    marginBottom: 15,
                    // backgroundColor: "rgb(26, 26, 26)",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    padding: 15,
                    display: "flex",
                    flexDirection: isSmallScreen ? "column" : "row",
                    gap: isSmallScreen ? 15 : 20
                }}
            >
                <div style={{ flex: 1, borderBottom: isSmallScreen ? '1px solid #333' : 'none', borderRight: isSmallScreen ? 'none' : '1px solid #333', paddingRight: isSmallScreen ? 0 : 15, paddingBottom: isSmallScreen ? 15 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <i data-feather="activity" style={{ width: 14, height: 14, color: '#70CAD1', opacity: 0.8 }}></i>
                        <span style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Connections</span>
                    </div>
                    <div style={{ fontSize: '1.2em', fontWeight: 700, color: '#70CAD1', fontFamily: 'monospace' }}>{store.io.activeConn}</div>
                </div>
                <div style={{ flex: 1, borderBottom: isSmallScreen ? '1px solid #333' : 'none', borderRight: isSmallScreen ? 'none' : '1px solid #333', paddingRight: isSmallScreen ? 0 : 15, paddingBottom: isSmallScreen ? 15 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <i data-feather="alert-triangle" style={{ width: 14, height: 14, color: outageColor }}></i>
                        <span style={{ fontSize: "0.8em", fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent Outages</span>
                    </div>
                    {pingMetrics.outages.length === 0 ? (
                        <div style={{ color: getColorAtPercent(0), fontSize: "0.85em", fontWeight: 500 }}>
                            All systems operational
                        </div>
                    ) : (
                        <div style={{ maxHeight: 80, overflowY: 'auto', paddingRight: 5 }}>
                            {pingMetrics.outages
                                .slice()
                                .reverse()
                                .map((o, i) => (
                                    <div key={i} style={{
                                        fontSize: "0.85em",
                                        marginBottom: 6,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        color: outageColor,
                                        fontFamily: 'monospace'
                                    }}>
                                        <span style={{ opacity: 0.8 }}>{formatShort(new Date(o.start))}</span>
                                        <span style={{ fontWeight: 600 }}>{Math.floor(o.duration_seconds / 60)}m {o.duration_seconds % 60}s</span>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, paddingLeft: isSmallScreen ? 0 : 5 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <i data-feather="unlock" style={{ width: 14, height: 14, color: '#eee', opacity: 0.6 }}></i>
                            <span style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Ports</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                            {store.networkMetrics.internet_ports.length > 0 ? (
                                store.networkMetrics.internet_ports.map((s, idx) => (
                                    <span key={idx} style={{
                                        fontSize: '0.85em',
                                        color: '#eee',
                                        fontFamily: 'monospace',
                                        fontWeight: 500
                                    }}>
                                        {s.replace(/open/g, "").trim()}
                                    </span>
                                ))
                            ) : (
                                <span style={{ fontSize: '0.85em', opacity: 0.4 }}>None</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div>
                <h3
                    style={{
                        borderBottom: "1px solid #444",
                        paddingBottom: 5,
                        marginTop: 15
                    }}
                >
                    Ping Statistics
                </h3>
                <table
                    style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.9em"
                    }}
                >
                    <thead>
                        <tr>
                            <th style={thStyle}>Period</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>Latency</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>Packet Loss</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pingPeriods.map((row) => {
                            const lat = pingMetrics.latency[row.k];
                            const loss = pingMetrics.packet_loss[row.k === "latest" ? "latest_percent" : row.k];
                            return (
                                <tr key={row.l}>
                                    <td style={{ ...tdStyle, width: "100%" }}>{row.l}</td>
                                    <td style={numStyle}>{lat != null ? lat + "ms" : "N/A"}</td>
                                    <td style={numStyle}>{loss != null ? loss + "%" : "N/A"}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div>
                <h3
                    style={{
                        borderBottom: "1px solid #444",
                        paddingBottom: 5,
                        marginTop: 15
                    }}
                >
                    Traffic History
                </h3>
                <table
                    style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.9em"
                    }}
                >
                    <thead>
                        <tr>
                            <th style={thStyle}>Time</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>RX Avg</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>RX Total</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>TX Avg</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>TX Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {trafficRows.map((row) => (
                            <tr key={row.p}>
                                <td style={{ ...tdStyle, width: "100%" }}>{row.p}</td>
                                <td style={numStyle}>{row.rxAvg}</td>
                                <td style={numStyle}>{row.rxTot}</td>
                                <td style={numStyle}>{row.txAvg}</td>
                                <td style={numStyle}>{row.txTot}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});

const InternetContent = observer(() => {
    const tdStyle = { padding: "8px", borderBottom: "1px solid #222" };
    const thStyle = {
        padding: "8px",
        textAlign: "left",
        borderBottom: "1px solid #444",
        fontSize: "0.9em",
        color: "#000",
        opacity: 0.7
    };
    return (
        <>
            {store.internetMetrics &&
                store.internetMetrics.map((server) => {
                    const isExpanded = store.iotExpandedDevices && store.iotExpandedDevices[server.id];
                    const currentStat = server.stats?.["1m"];
                    const currentAvg = currentStat ? currentStat[3] : null;
                    const currentLoss = currentStat ? currentStat[0] : null;

                    return (
                        <div
                            key={server.id}
                            style={{
                                marginBottom: 15,
                                // backgroundColor: "#1a1a1a",
                                borderRadius: 8,
                                overflow: "hidden",
                                border: "1px solid rgba(255, 255, 255, 0.1)"
                            }}
                        >
                            <div
                                style={{
                                    padding: 15,
                                    cursor: "pointer",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10
                                }}
                                onClick={() => {
                                    store.iotExpandedDevices = {
                                        ...(store.iotExpandedDevices || {}),
                                        [server.id]: !isExpanded
                                    };
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center"
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 600, color: "#eee" }}>
                                            {server.hostname}
                                        </div>
                                        <div style={{ fontSize: "0.8em", opacity: 0.6, marginTop: 2 }}>
                                            {server.address}
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "0.9em",
                                            opacity: 0.8,
                                            textAlign: "right"
                                        }}
                                    >
                                        {currentStat ? (
                                            <>
                                                <span style={{ color: iotPingColor(currentAvg, currentLoss) }}>
                                                    {currentAvg}ms
                                                </span>
                                                <br />
                                                <span style={{ fontSize: "0.8em", opacity: 0.7 }}>{currentLoss}% loss</span>
                                            </>
                                        ) : (
                                            <span style={{ opacity: 0.4 }}>N/A</span>
                                        )}
                                    </div>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        height: 6,
                                        width: "100%",
                                        borderRadius: 3,
                                        overflow: "hidden",
                                        gap: 0,
                                        backgroundColor: "#111"
                                    }}
                                >
                                    {server.history &&
                                        server.history.slice(-30).map((stat, i, arr) => {
                                            const avg = stat[3];
                                            const loss = stat[0];
                                            const color = iotPingColor(avg, loss);
                                            return (
                                                <div
                                                    key={i}
                                                    title={`${avg}ms`}
                                                    style={{
                                                        flex: 1,
                                                        backgroundColor: color,
                                                        opacity: 0.2 + 0.8 * (i / arr.length)
                                                    }}
                                                ></div>
                                            );
                                        })}
                                </div>
                            </div>
                            {isExpanded && (
                                <div
                                    style={{
                                        padding: "0 15px 15px 15px",
                                        fontSize: "0.85em",
                                        borderTop: "1px solid #2a2a2a",
                                        marginTop: -5,
                                        paddingTop: 10
                                    }}
                                >
                                    <table
                                        style={{
                                            width: "100%",
                                            borderCollapse: "collapse",
                                            opacity: 0.9
                                        }}
                                    >
                                        <thead>
                                            <tr
                                                style={{
                                                    borderBottom: "1px solid #333",
                                                    textAlign: "left",
                                                    color: "#000"
                                                }}
                                            >
                                                <th style={{ ...thStyle }}>Period</th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Ping (Avg)
                                                </th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Loss
                                                </th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Min / Max
                                                </th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Jitter
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {["1m", "5m", "15m", "1h", "3h", "12h", "24h"].map((k) => {
                                                const stat = server.stats?.[k];
                                                if (!stat) return null;
                                                return (
                                                    <tr key={k} style={{ borderBottom: "1px solid #222" }}>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                width: "100%",
                                                                color: k === "1m" ? "#fff" : "#aaa"
                                                            }}
                                                        >
                                                            {k}
                                                        </td>
                                                        <td style={{ ...tdStyle, textAlign: "right" }}>{stat[3]}ms</td>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                textAlign: "right",
                                                                color: stat[0] > 0 ? "#ff5555" : "inherit"
                                                            }}
                                                        >
                                                            {stat[0]}%
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                textAlign: "right",
                                                                opacity: 0.7
                                                            }}
                                                        >
                                                            {stat[1]}ms / {stat[2]}ms
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                textAlign: "right",
                                                                opacity: 0.7
                                                            }}
                                                        >
                                                            {stat[4]}ms
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                })}
            {(!store.internetMetrics || store.internetMetrics.length === 0) && (
                <div
                    style={{
                        padding: 40,
                        textAlign: "center",
                        opacity: 0.5,
                        fontStyle: "italic"
                    }}
                >
                    No internet servers are currently being monitored.
                </div>
            )}
        </>
    );
});

const IoTContent = observer(() => {
    const tdStyle = { padding: "8px", borderBottom: "1px solid #222" };
    const thStyle = {
        padding: "8px",
        textAlign: "left",
        borderBottom: "1px solid #444",
        fontSize: "0.9em",
        color: "#000",
        opacity: 0.7
    };
    return (
        <>
            {store.iotMetrics &&
                store.iotMetrics.map((device) => {
                    const isExpanded = store.iotExpandedDevices && store.iotExpandedDevices[device.mac];
                    const currentStat = device.stats?.["1m"];
                    const currentAvg = currentStat ? currentStat[3] : null;
                    const currentLoss = currentStat ? currentStat[0] : null;

                    return (
                        <div
                            key={device.mac}
                            style={{
                                marginBottom: 15,
                                // backgroundColor: "#1a1a1a",
                                borderRadius: 8,
                                overflow: "hidden",
                                border: "1px solid rgba(255, 255, 255, 0.1)"
                            }}
                        >
                            <div
                                style={{
                                    padding: 15,
                                    cursor: "pointer",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10
                                }}
                                onClick={() => {
                                    store.iotExpandedDevices = {
                                        ...(store.iotExpandedDevices || {}),
                                        [device.mac]: !isExpanded
                                    };
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center"
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 600, color: "#eee" }}>
                                            {device.hostname || "Unknown Host"}
                                        </div>
                                        <div style={{ fontSize: "0.8em", opacity: 0.6, marginTop: 2 }}>
                                            {device.ip} • <span style={{ fontFamily: "monospace" }}>{device.mac}</span>
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "0.9em",
                                            opacity: 0.8,
                                            textAlign: "right"
                                        }}
                                    >
                                        {currentStat ? (
                                            <>
                                                <span style={{ color: iotPingColor(currentAvg, currentLoss) }}>
                                                    {currentAvg}ms
                                                </span>
                                                <br />
                                                <span style={{ fontSize: "0.8em", opacity: 0.7 }}>{currentLoss}% loss</span>
                                            </>
                                        ) : (
                                            <span style={{ opacity: 0.4 }}>N/A</span>
                                        )}
                                    </div>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        height: 6,
                                        width: "100%",
                                        borderRadius: 3,
                                        overflow: "hidden",
                                        gap: 0,
                                        backgroundColor: "#111"
                                    }}
                                >
                                    {device.history &&
                                        device.history.slice(-30).map((stat, i, arr) => {
                                            const avg = stat[3];
                                            const loss = stat[0];
                                            const color = iotPingColor(avg, loss);
                                            return (
                                                <div
                                                    key={i}
                                                    title={`${avg}ms`}
                                                    style={{
                                                        flex: 1,
                                                        backgroundColor: color,
                                                        opacity: 0.2 + 0.8 * (i / arr.length)
                                                    }}
                                                ></div>
                                            );
                                        })}
                                </div>
                            </div>
                            {isExpanded && (
                                <div
                                    style={{
                                        padding: "0 15px 15px 15px",
                                        fontSize: "0.85em",
                                        borderTop: "1px solid #2a2a2a",
                                        marginTop: -5,
                                        paddingTop: 10
                                    }}
                                >
                                    <table
                                        style={{
                                            width: "100%",
                                            borderCollapse: "collapse",
                                            opacity: 0.9
                                        }}
                                    >
                                        <thead>
                                            <tr
                                                style={{
                                                    borderBottom: "1px solid #333",
                                                    textAlign: "left",
                                                    color: "#000"
                                                }}
                                            >
                                                <th style={{ ...thStyle }}>Period</th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Ping (Avg)
                                                </th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Loss
                                                </th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Min / Max
                                                </th>
                                                <th
                                                    style={{
                                                        ...thStyle,
                                                        textAlign: "right"
                                                    }}
                                                >
                                                    Jitter
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {["1m", "5m", "15m", "1h", "3h", "12h", "24h"].map((k) => {
                                                const stat = device.stats?.[k];
                                                if (!stat) return null;
                                                return (
                                                    <tr key={k} style={{ borderBottom: "1px solid #222" }}>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                width: "100%",
                                                                color: k === "1m" ? "#fff" : "#aaa"
                                                            }}
                                                        >
                                                            {k}
                                                        </td>
                                                        <td style={{ ...tdStyle, textAlign: "right" }}>{stat[3]}ms</td>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                textAlign: "right",
                                                                color: stat[0] > 0 ? "#ff5555" : "inherit"
                                                            }}
                                                        >
                                                            {stat[0]}%
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                textAlign: "right",
                                                                opacity: 0.7
                                                            }}
                                                        >
                                                            {stat[1]}ms / {stat[2]}ms
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...tdStyle,
                                                                textAlign: "right",
                                                                opacity: 0.7
                                                            }}
                                                        >
                                                            {stat[4]}ms
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                })}
            {(!store.iotMetrics || store.iotMetrics.length === 0) && (
                <div
                    style={{
                        padding: 40,
                        textAlign: "center",
                        opacity: 0.5,
                        fontStyle: "italic"
                    }}
                >
                    No IoT devices are currently being monitored.
                </div>
            )}
        </>
    );
});

const AlertOverlay = observer(() => {
    const shouldShow = !shouldPowerSave() && store.alertMessage && store.alertExpire > Math.max(store.uiPollingTimestamp, Date.now());
    const { shouldRender, style } = useModalTransition(shouldShow);

    if (!shouldRender) return null;

    return (
        <div
            style={{
                display: "flex",
                width: "100%",
                height: "100%",
                position: "fixed",
                zIndex: 6,
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(4px) brightness(0.65)",
                transition: "all 0.3s ease-in-out",
                top: 0,
                left: 0,
                ...style
            }}
            onClick={() => (store.alertExpire = 0)}
        >
            <div
                className="container"
                style={{
                    backgroundColor: "rgba(0,0,0,0.9)",
                    paddingTop: 20,
                    paddingRight: 20,
                    paddingLeft: 20,
                    borderRadius: 20,
                    minWidth: 300
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ textAlign: "center", fontSize: "1.5em" }}>{store.alertMessage[0]}</div>
                <div style={{ maxHeight: "calc(100vh - 100px)", overflow: "scroll" }}>
                    <pre
                        style={{
                            margin: 0,
                            padding: 0,
                            whiteSpace: "pre-wrap",
                            fontSize: "0.75em",
                            paddingBottom: 20
                        }}
                    >
                        {store.alertMessage[1]}
                    </pre>
                    {store.alertMessage[2] && <div style={{ paddingBottom: 20 }}>{store.alertMessage[2]}</div>}
                </div>
            </div>
        </div>
    );
});

const NetworkBars = observer(({ isSmallLandscape }) => {
    if (!store.networkMetrics) return (<div></div>);
    console.log("NetworkBars");
    const minuteHistory = store.networkMetrics?.ping_statistics?.minute_history || [];
    const trafficHistory = store.networkMetrics?.network_traffic?.minute_history || [];
    const pingStatistics = store.networkMetrics?.ping_statistics;
    const internetPorts = store.networkMetrics?.internet_ports || [];
    const networkLastUpdated = store.networkMetrics?.last_updated;
    console.log("NetworkBars", minuteHistory);

    return (
        <div
            style={{
                width: "100%",
                paddingTop: isSmallLandscape ? 8 : 16,
                paddingBottom: 16,
                cursor: "pointer",
                transition: "transform 0.2s ease-in-out, filter 0.2s ease-in-out"
            }}
            onMouseEnter={
                window.matchMedia("(hover: hover) and (pointer: fine)").matches
                    ? (e) => {
                        e.currentTarget.style.transform = "scale(1.02)";
                        e.currentTarget.style.filter = "brightness(1.5)";
                    }
                    : undefined
            }
            onMouseLeave={
                window.matchMedia("(hover: hover) and (pointer: fine)").matches
                    ? (e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.filter = "brightness(1)";
                    }
                    : undefined
            }
            onClick={() => {
                store.showNetworkModal = true
            }}
        >
            <div style={{ borderRadius: 10, overflow: "hidden" }}>
                <div
                    style={{
                        display: "flex",
                        height: 17,
                        width: "100%",
                        gap: 0,
                        backgroundColor: "#111",
                        justifyContent: "space-between",
                        zIndex: 2
                    }}
                >
                    {minuteHistory.map((h, i, arr) => (
                        <div
                            key={i}
                            style={{
                                flex: 1,
                                opacity: 1 - (arr.length - (i + 1)) * 0.015,
                                backgroundColor:
                                    h.latency_ms === null || h.latency_ms === -1
                                        ? "#444444"
                                        : getColorAtPercent(
                                            Math.min(100, Math.max(h.latency_ms ** 2 / 10, h.packet_loss_percent))
                                        )
                            }}
                        ></div>
                    ))}
                </div>
                {trafficHistory.length > 0 && (
                    <div style={{ width: "100%", paddingTop: 1 }}>
                        <div
                            style={{
                                display: "flex",
                                height: 3,
                                width: "100%",
                                overflow: "hidden",
                                gap: 0,
                                backgroundColor: "#111",
                                justifyContent: "space-between",
                                zIndex: 2
                            }}
                        >
                            {trafficHistory.map((h, i, arr) => {
                                let traffic = h.avg_rx_Bps + h.avg_tx_Bps;
                                let pct = Math.min(
                                    100,
                                    Math.max(
                                        (h.avg_rx_Bps / store.GAUGE_LIMITS.io.networkRx.max) ** 0.7 * 100,
                                        (h.avg_tx_Bps / store.GAUGE_LIMITS.io.networkTx.max) ** 0.7 * 100
                                    ),
                                );
                                return (
                                    <div
                                        key={i}
                                        title={``}
                                        style={{
                                            flex: 1,
                                            opacity: 1 - (arr.length - (i + 1)) * 0.015,
                                            backgroundColor: traffic === 0 ? "#444444" : getColorAtPercent(pct)
                                        }}
                                    ></div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
            {pingStatistics && (
                <div
                    style={{
                        zIndex: 2,
                        marginTop: 4,
                        justifyContent: "space-between",
                        position: "relative",
                        fontSize: "0.8em",
                        display: "flex"
                    }}
                >
                    <div style={{ fontWeight: 400, opacity: 0.5, marginLeft: -2 }}>
                        {internetPorts.map((s) => s.replace(/open/g, "").trim()).join(", ")}
                    </div>
                    <div
                        style={{
                            fontWeight: 400,
                            opacity: 0.8,
                            marginRight: -2,
                            color: getColorAtPercent(
                                Math.min(
                                    100,
                                    Math.max(
                                        (pingStatistics.latency.last1m || pingStatistics.latency.latest || 0) ** 2 / 10,
                                        pingStatistics.packet_loss.last1m || 0
                                    )
                                )
                            )
                        }}
                    >
                        {networkLastUpdated && Date.now() - networkLastUpdated > 12000 && (
                            <>{formatTimeDiff(networkLastUpdated)} •&nbsp;</>
                        )}
                        {store.io.activeConn} conns •&nbsp;
                        {(pingStatistics.latency.last1m || pingStatistics.latency.latest || 0)?.toFixed(1)}
                        ms •&nbsp;
                        {(pingStatistics.packet_loss.last1m || 0)?.toFixed(1)}% loss
                    </div>
                </div>
            )}
        </div>
    );
});

const FullscreenButton = () => {
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    }, []);

    const toggleFullscreen = (e) => {
        e.stopPropagation();
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
        }
        store.lastInteract = Date.now();
    };

    if (isFullscreen) return null;
    if (store.showNetworkModal || store.storageModalTarget) return null;

    return (
        <div
            onClick={toggleFullscreen}
            style={{
                position: "fixed",
                right: "20px",
                bottom: "20px",
                width: "50px",
                height: "50px",
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                cursor: "pointer",
                zIndex: 100,
                backdropFilter: "blur(4px)",
                userSelect: "none",
                transition: "transform 0.2s ease, opacity 0.2s ease"
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.1)";
                e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
            }}
        >
            🖼
        </div>
    );
};

const Monitor = observer(() => {
    let loadLevel = 0;
    let fullLoadItems = Object.values(store.usage).filter((u) => u >= 80).length;
    if (fullLoadItems >= 3) loadLevel = 2;
    else if (fullLoadItems === 2) loadLevel = 1;

    let isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;
    let isSmallLandscape = isSmallScreen && store.windowWidth > store.windowHeight;

    let sectionMinHeight = isSmallScreen ? 170 : undefined;
    let infoFontSize = isSmallScreen ? "70%" : undefined;
    let infoWidth = isSmallScreen ? 150 : 240;
    let infoMT = isSmallScreen ? -20 : undefined;
    const isUsingBackupNetwork = store.io.isUsingBackup;

    console.log("render");

    return (
        <>
            <div
                className="container"
                style={{
                    display: isSmallLandscape ? "flex" : undefined,
                    flexWrap: isSmallLandscape ? "wrap" : undefined,
                    maxWidth: isSmallLandscape ? "100vw" : undefined
                }}
            >
                <div style={{ paddingTop: 10 }}></div>
                <div
                    className="section"
                    style={{
                        minHeight: sectionMinHeight,
                        width: isSmallLandscape ? "calc(50% - 40px)" : undefined,
                        marginRight: isSmallLandscape ? 80 : undefined
                    }}
                >
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
                        {Object.values(store.disks).map((disk) => (
                            <Gauge
                                key={disk.label}
                                value={disk.temperature}
                                min={disk.temperatureLimit.min}
                                max={disk.temperatureLimit.max}
                                label={`SSD (${disk.name})`}
                                className="temperature"
                                featherName="hard-drive"
                            />
                        ))}
                    </div >
                </div >
                <div
                    className="section"
                    style={{
                        minHeight: sectionMinHeight,
                        width: isSmallLandscape ? "calc(50% - 40px)" : undefined
                    }}
                >
                    <div className="section-title">Usage</div>
                    <div className="gauge-container" style={{ marginTop: isSmallLandscape ? 25 : undefined }}>
                        <Gauge
                            value={store.usage.cpu}
                            max={100}
                            label="CPU"
                            className="usage"
                            featherName="cpu"
                            small
                            cpuFreq
                        />
                        <Gauge
                            value={store.usage.ram}
                            valueMB={store.usageMB.ram}
                            max={100}
                            label="RAM"
                            className="usage"
                            featherName="server"
                            small
                        />
                        {Object.values(store.disks).map((disk) => (
                            <Gauge
                                key={disk.label}
                                value={disk.usage}
                                valueGB={disk.usageGB}
                                max={100}
                                label={disk.name}
                                className="usage"
                                featherName="hard-drive"
                                small
                                clickFn={() => (store.storageModalTarget = disk.label)}
                                textColor={STORAGE_TEXT_COLOR[store.storageInfo[disk.label]?.info?.status || 0]}
                                textExtra={STORAGE_EXTRA_TEXT[store.storageInfo[disk.label]?.info?.status || 0]}
                            />
                        ))}
                    </div>
                </div>
                <div
                    className="section"
                    style={{
                        minHeight: sectionMinHeight,
                        width: isSmallLandscape ? "calc(50% - 40px)" : undefined,
                        marginRight: isSmallLandscape ? 40 : undefined,
                        marginTop: isSmallLandscape ? 10 : undefined
                    }}
                >
                    <div className="section-title">I/O</div>
                    <div className="gauge-container" style={{ marginTop: isSmallLandscape ? 20 : undefined }}>
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
                            max={
                                isUsingBackupNetwork
                                    ? store.GAUGE_LIMITS.io.backupNetworkRx.max
                                    : store.GAUGE_LIMITS.io.networkRx.max
                            }
                            label="Internet RX"
                            labelExtra={formatBytes(
                                isUsingBackupNetwork ? store.io.backupNetworkPacketsRx : store.io.networkPacketsRx,
                                1,
                                "PPS"
                            )}
                            className="io"
                            featherName="globe"
                            small
                            textColor={isUsingBackupNetwork ? "#F7EE7F" : undefined}
                        />
                        <Gauge
                            value={isUsingBackupNetwork ? store.io.backupNetworkTx : store.io.networkTx}
                            max={
                                isUsingBackupNetwork
                                    ? store.GAUGE_LIMITS.io.backupNetworkTx.max
                                    : store.GAUGE_LIMITS.io.networkTx.max
                            }
                            label="Internet TX"
                            labelExtra={formatBytes(
                                isUsingBackupNetwork ? store.io.backupNetworkPacketsTx : store.io.networkPacketsTx,
                                1,
                                "PPS"
                            )}
                            className="io"
                            featherName="globe"
                            small
                            textColor={isUsingBackupNetwork ? "#F7EE7F" : undefined}
                        />
                    </div>
                </div>
                <div
                    style={{
                        display: "flex",
                        marginTop: isSmallLandscape ? 10 : infoMT,
                        width: isSmallLandscape ? "calc(50% - 40px)" : undefined,
                        flexGrow: isSmallLandscape ? 1 : undefined
                    }}
                >
                    <div className="section" style={{ flexGrow: 1, minHeight: sectionMinHeight }}>
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
                                value={store.fanSpeed.ssd}
                                max={store.GAUGE_LIMITS.fanSpeed.ssd.max}
                                label="SSD"
                                className="fan"
                                featherName="hard-drive"
                            />
                        </div>
                    </div>
                    <div
                        className="section"
                        style={{
                            display: "flex",
                            width: isSmallLandscape ? 170 : infoWidth,
                            minHeight: sectionMinHeight
                        }}
                    >
                        <div className="section-title">&nbsp;</div>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "end",
                                justifyContent: "end",
                                paddingBottom: isSmallScreen ? 10 : 20,
                                width: "100%",
                                fontSize: infoFontSize,
                                zIndex: 2
                            }}
                        >
                            <div
                                style={{
                                    fontSize: "1.5em",
                                    fontWeight: 600,
                                    zIndex: 2,
                                    color: COLOR_STOPS[loadLevel].color
                                }}
                            >
                                {store.SYSTEM_INFO.hostname}
                            </div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.cpu}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.gpu}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.case}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.os}</div>
                            <div style={{ fontWeight: 500, opacity: 0.8 }}>{store.system}</div>
                            <div style={{ fontWeight: 600 }}>{getGMT8Time(store.lastUpdate)}</div>
                            {
                                // <div>{JSON.stringify(store.livingRoomInfo)} {store.mainUIBrightness}</div>
                            }
                        </div>
                    </div>
                </div>
                <NetworkBars isSmallLandscape={isSmallLandscape} />
            </div>

            {!shouldPowerSave() && (
                <>
                    <NetworkModal />
                    <StorageModal />
                    <AlertOverlay />
                </>
            )}
            <FullScreenStatus />
            <FullscreenButton />
        </>
    );
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

function panelAlert(content, title, expire = 10000, footer = null) {
    exitPowerSaveIfNeeded();
    store.alertMessage = [title, content, footer];
    store.alertExpire = Date.now() + expire;
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
        const info = typeof data === "string" ? JSON.parse(data) : data;
        for (let k of Object.keys(info)) store[k] = info[k];
        let now = Date.now();
        if (store.firstDataPushedAt === 0) store.firstDataPushedAt = now;
        store.lastDataPushedAt = now;
        if (now - store.uiPollingTimestamp > RELAX_BUFFER_MS) {
            store.uiPollingTimestamp = now;
            console.log("store.uiPollingTimestamp = now", "saveToMobxStore");
        }
    } catch (error) {
        console.error(`Error processing ${label}:`, error);
    }
};

socket.on("storageInfo", saveToMobxStore("storageInfo"));
socket.on("initInfo", saveToMobxStore("initInfo"));
socket.on("metrics", saveToMobxStore("metrics"));
socket.on("networkMetrics", saveToMobxStore("networkMetrics"));
socket.on("iotMetrics", saveToMobxStore("iotMetrics"));
socket.on("internetMetrics", saveToMobxStore("internetMetrics"));

socket.on("connect", () => console.log("Connected to server"));

window.addEventListener("resize", () => {
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
let currentGetStatesRequestId = null;
let sttBinaryHandlerId = null;

let wakeWordTimeoutId = null;
let ttsAudioElement = null; // To control TTS playback
let conversationId = newConversationId();
const audioCache = {};
// Configuration - HA_URL is constant, TOKEN and PIPELINE_NAME are fetched
let HA_TOKEN = null;
let HA_ASSIST_PIPELINE_NAME = null;

// --- Helper Functions ---
function getStateName(stateValue) {
    return Object.keys(STATE).find((key) => STATE[key] === stateValue) || "UNKNOWN_STATE";
}
async function fetchAndCacheAudio(url) {
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
        // v = NIGHT_VOL;
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

    console.log(
        `State transition: ${getStateName(oldState)} -> ${getStateName(newState)} ${args.length > 0 ? JSON.stringify(args) : ""}`
    );
    store.vaState = newState;

    // Clear any state-specific timers/handlers from the OLD state
    if (wakeWordTimeoutId) {
        clearTimeout(wakeWordTimeoutId);
        wakeWordTimeoutId = null;
    }

    if (oldState === STATE.PLAYING_TTS && newState !== STATE.PLAYING_TTS) {
        if (ttsAudioElement) {
            console.log("Stopping TTS audio due to state change from PLAYING_TTS.");
            ttsAudioElement.pause();
            ttsAudioElement.src = "";
            ttsAudioElement.onended = null;
            ttsAudioElement.onerror = null;
            ttsAudioElement = null;
        }
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
                (async () => {
                    (await fetchAndCacheAudio(BASE + "/cancel.mp3")).play().catch((e) => console.error("Error playing cancel.mp3:", e));
                })();
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
                (async () => {
                    (await fetchAndCacheAudio(BASE + "/activate.mp3")).play().catch((e) => console.error("Error playing activate.mp3:", e));
                })();
                wakeWordTimeoutId = setTimeout(() => {
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && !pipelineActive) {
                        // No speech started
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
            (async () => {
                (await fetchAndCacheAudio(BASE + "/analyzing.mp3")).play().catch((e) => console.error("Error playing analyzing.mp3:", e));
            })();
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
            pipelineActive = false; // HA interaction part is done

            if (ttsAudioElement) {
                // Clear any previous TTS
                ttsAudioElement.pause();
                ttsAudioElement.src = "";
                ttsAudioElement.onended = null;
                ttsAudioElement.onerror = null;
            }

            console.log("STATE.PLAYING_TTS: Playing TTS from URL:", ttsUrl);
            ttsAudioElement = new Audio(ttsUrl);
            if (store.lastTTSLength > 20) {
                ttsAudioElement.playbackRate = 1.5; // Set playback speed to 1.5x
            } else {
                ttsAudioElement.playbackRate = 1.25;
            }
            ttsAudioElement.onended = () => {
                console.log("TTS playback naturally ended.");
                ttsAudioElement = null;
                if (store.vaState === STATE.PLAYING_TTS) {
                    setVAState(STATE.WAKE_WORD_TRIGGERED);
                }
            };
            ttsAudioElement.onerror = (e) => {
                console.error("Error playing TTS audio:", e);
                panelAlert("Error playing assistant response.");
                ttsAudioElement = null;
                if (store.vaState === STATE.PLAYING_TTS) {
                    setVAState(STATE.WAKE_WORD_TRIGGERED);
                }
            };
            ttsAudioElement.play().catch((e) => {
                console.error("Error initiating TTS playback:", e);
                panelAlert("Could not play assistant response.");
                ttsAudioElement = null;
                if (store.vaState === STATE.PLAYING_TTS) {
                    setVAState(STATE.WAKE_WORD_TRIGGERED);
                }
            });
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
        const newUrl = window.location.pathname + (newSearch ? "?" + newSearch : "");
        window.history.replaceState({}, document.title, newUrl);
        return valueFromUrl;
    }
    return localStorage.getItem(storageKey);
}

function getHAToken() {
    return getConfigValue("token", "ha_token");
}
function getHAPipelineName() {
    return getConfigValue("pipeline_name", "ha_pipeline_name");
}

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
        await connectWebSocket(); // This also attempts VAD initialization on auth_ok
        console.log("HA WebSocket connection established, VAD init process started.");
    } catch (error) {
        console.error("Failed to establish initial HA connection or init VAD:", error);
        panelAlert("Could not connect to Home Assistant or init voice: " + error.message);
        // Allow Bumblebee to start; hotword might trigger successful connection
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        console.log("Microphone permission granted.");
    } catch (err) {
        console.error("Microphone permission denied:", err);
        // panelAlert("Microphone access is required: " + err.message);
        return;
    }

    try {
        bumblebee = new Bumblebee();
        bumblebee.setWorkersPath("/vendor/bumblebee/workers");
        bumblebee.addHotword("jarvis");
        bumblebee.addHotword("bumblebee");
        bumblebee.setSensitivity(0.3);
        bumblebee.on("hotword", handleHotword);
        console.log("Bumblebee initialized.");
    } catch (error) {
        console.error("Failed to initialize Bumblebee:", error);
        panelAlert("Error initializing hotword engine: " + error.message);
        return;
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

function resetAll() {
    pipelineActive = false;
    resetAudioStreamingState();
    conversationId = newConversationId();
    setVAState(STATE.IDLE);
    panelAlert(
        null,
        <h1>
            <center>AI Reset Success</center>
        </h1>,
        3000
    );
}

async function handleHotword(hotwordDetails) {
    return;
    const hotword = typeof hotwordDetails === "string" ? hotwordDetails : hotwordDetails.hotword;
    console.log(`Hotword '${hotword}' detected. Current state: ${getStateName(store.vaState)}.`);
    if (hotword === "bumblebee") {
        resetAll();
        return;
    }
    if (Date.now() - store.voiceLastActiveAt > 300 * 1000) {
        console.log("Resetting conversation");
        conversationId = newConversationId();
    }
    store.voiceLastActiveAt = Date.now();
    store.lastSTT = "";
    store.lastTTS = "幫緊你幫緊你...";

    if (store.vaState === STATE.SENDING_AUDIO || (store.vaState === STATE.WAKE_WORD_TRIGGERED && pipelineActive)) {
        console.log("Pipeline or VAD already processing speech for HA. Ignoring hotword.");
        return;
    }

    // Re-check config
    HA_TOKEN = getHAToken();
    HA_ASSIST_PIPELINE_NAME = getHAPipelineName();
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
                initializeVAD()
                    .then(resolve)
                    .catch((err) => {
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
        const wsUrl = HA_URL.replace(/^http/, "ws") + "/api/websocket";
        haWebSocket = new WebSocket(wsUrl);

        haWebSocket.onopen = () => console.log("WebSocket connection opened.");
        haWebSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case "auth_required":
                    console.log("WebSocket: Auth required.");
                    if (HA_TOKEN) {
                        haWebSocket.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
                    } else {
                        console.error("WebSocket: Auth required but HA_TOKEN missing.");
                        haWebSocket.close();
                        reject(new Error("Session token unavailable during auth."));
                    }
                    break;
                case "auth_ok":
                    console.log("WebSocket: Authentication successful.");

                    // Subscribe to state changes
                    sendMessage({ type: "subscribe_events", event_type: "state_changed" });
                    currentGetStatesRequestId = sendMessage({ type: "get_states" });

                    initializeVAD()
                        .then(() => {
                            console.log("VAD initialized successfully post-auth.");
                            requestDeviceAndPipelineInfo();
                            resolve();
                        })
                        .catch((vadError) => {
                            console.error("VAD initialization failed after auth_ok:", vadError);
                            // Resolve WS connection, but VAD is an issue. App might still work for non-VAD things.
                            // Or reject depending on how critical VAD is for this promise.
                            // For connectWebSocket, successful auth is key. VAD can be re-attempted.
                            resolve();
                            // reject(new Error('VAD initialization failed: ' + vadError.message));
                        });
                    break;
                case "auth_invalid":
                    console.error("WebSocket: Authentication failed - invalid token.");
                    localStorage.removeItem("ha_token");
                    HA_TOKEN = null;
                    panelAlert("HA token is invalid. Please provide a new token and refresh.");
                    haWebSocket.close();
                    reject(new Error("WebSocket auth failed: Invalid token."));
                    break;
                case "result":
                    if (message.id === currentGetStatesRequestId && message.success) {
                        message.result.forEach(state => {
                            updateState(state);
                        });
                    }

                    if (message.id === currentPipelineRunId && !message.success) {
                        console.error("HA WS: assist_pipeline/run command failed:", message.error);
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
                            if (message.result.assist_pipeline_preferred)
                                console.log("VA: Preferred pipeline from device config:", message.result.assist_pipeline_preferred);
                        } else console.warn("HA WS: Failed to get device config:", message.error);
                    }

                    break;
                case "event":
                    if (message.event.event_type === "state_changed") {
                        updateState(message.event.data.new_state);
                    } else {
                        handlePipelineEvent(message.event);
                    }
                    break;
                case "pong":
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
                        connectWebSocket().catch((err) => console.error("VA: WebSocket auto-reconnect failed:", err.message));
                    }
                }, 5000);
            }
        };
        haWebSocket.onerror = (error) => {
            console.error("WebSocket error event:", error);
            const wasPipelineActive = pipelineActive;
            pipelineActive = false;
            resetAudioStreamingState();
            // onclose will set haWebSocket to null and handle state transition for active ops
            if (store.vaState !== STATE.INITIALIZING && store.vaState !== STATE.IDLE) {
                // This might be redundant if onclose handles it, but good for clarity
                console.log("WebSocket error, transitioning to IDLE state from onerror.");
                if (wasPipelineActive) panelAlert("Connection error with Home Assistant.");
                // setState(STATE.IDLE); // onclose should also trigger this if needed.
            }
            reject(new Error("WebSocket connection error."));
        };
    });
}

function initializeVAD() {
    return new Promise(async (resolve, reject) => {
        if (myvad) {
            console.log("VAD instance already exists.");
            resolve();
            return;
        }
        console.log("Initializing VAD...");
        try {
            if (typeof vad === "undefined" || typeof vad.MicVAD === "undefined") {
                return reject(new Error("VAD library not found."));
            }
            myvad = await vad.MicVAD.new({
                model: "v5",
                onnxWASMBasePath: "/vendor/ort/",
                baseAssetPath: "/vendor/vad/",
                redemptionFrames: 16,
                onSpeechRealStart: () => {
                    console.log("VAD: Speech really started.");
                    store.voiceLastActiveAt = Date.now();
                    store.isUserSpeaking = true;
                    if (wakeWordTimeoutId) {
                        // Clear "no speech after wake word" timeout
                        clearTimeout(wakeWordTimeoutId);
                        wakeWordTimeoutId = null;
                    }
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                        initiateHAPipelineRun(); // This will set pipelineActive = true on success
                    } else {
                        console.warn(`VAD: Speech started in unexpected state: ${getStateName(store.vaState)}.`);
                    }
                },
                onSpeechEnd: async (finalAudioBuffer) => {
                    // finalAudioBuffer is the ENTIRE utterance
                    console.log("VAD: Speech ended.");
                    if (myvad && myvad.listening) {
                        console.log("VAD: Speech ended, pausing VAD for this interaction.");
                        myvad.pause();
                    }
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && pipelineActive) {
                        // Send the complete utterance. processAndSendAudio will queue it.
                        // sendAudioToHA will send it as one message (or you could adapt it to chunk if HA prefers).
                        // The 'true' flag ensures sendHAStreamEnd is called afterwards.
                        await processAndSendAudio(finalAudioBuffer);
                        setVAState(STATE.SENDING_AUDIO); // Transition: VAD speech done, now waiting for HA
                    } else {
                        console.warn(
                            `VAD: Speech ended, but state (${getStateName(store.vaState)}) or pipelineActive (${pipelineActive}) is not receptive.`
                        );
                        if (!pipelineActive && store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                            // Speech ended, but pipeline never started or failed early.
                            panelAlert("Could not process your request.");
                            setVAState(STATE.IDLE);
                        }
                    }
                }
            });
            console.log("VAD initialized successfully.");
            resolve();
        } catch (error) {
            console.error("VA: Error initializing VAD:", error);
            myvad = null;
            reject(error);
        }
    });
}

function sendMessage(message) {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
        console.warn("sendMessage: WebSocket not open.");
        return -1;
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
    currentPipelineListRequestId = sendMessage({
        type: "assist_pipeline/pipeline/list"
    });
}
function resetAudioStreamingState() {
    haReadyForAudio = false;
    sttBinaryHandlerId = null;
}

function float32ToInt16(buffer) {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7fff;
    return buf;
}

function newConversationId() {
    return "monitor-" + Date.now();
}

async function processAndSendAudio(audio) {
    if (!pipelineActive || !(store.vaState === STATE.WAKE_WORD_TRIGGERED || store.vaState === STATE.SENDING_AUDIO)) {
        if (pipelineActive)
            console.warn(
                "processAndSendAudio: called while pipelineActive but in incompatible state: " + getStateName(store.vaState)
            );
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

function updateState(state) {
    if (!state) return;
    const entityId = state.entity_id;
    if (entityId === "binary_sensor.human_presence_sensor_e235_occupancy") {
        store.livingRoomOccupied = state.state === "on";
        store.updateBrightness();
        console.log({ state })

    } else if (entityId === "sensor.lumi_lumi_sen_ill_agl01") {
        store.livingRoomLux = parseFloat(state.state);
        store.updateBrightness();
        console.log({ state })

    }
}

function handlePipelineEvent(event) {
    // Should primarily be in SENDING_AUDIO, or WAKE_WORD_TRIGGERED (for run-start after speech started)
    if (!pipelineActive && !(store.vaState === STATE.PLAYING_TTS && event.type === "tts-end")) {
        // Allow tts-end if somehow pipeline became inactive before TTS
        console.warn(
            `Pipeline event '${event.type}' received but pipeline not active or state (${getStateName(store.vaState)}) not expecting it. Data:`,
            event.data
        );
        // If it's a critical error, transition to IDLE
        if (event.type === "error") {
            console.error(
                "VA: HA Pipeline Error Event (unexpected state/pipeline inactive):",
                event.data.code,
                event.data.message
            );
            panelAlert(`Voice assistant error: ${event.data.message}`);
            setVAState(STATE.IDLE);
        }
        return;
    }

    console.log("pipeline", event.type);
    switch (event.type) {
        case "run-start":
            console.log("Pipeline event: 'run-start'. HA ready for audio.", event.data);
            haReadyForAudio = true; // Indicates HA is ready to start the pipeline stages

            // Capture the stt_binary_handler_id for sending audio
            if (event.data && event.data.runner_data && typeof event.data.runner_data.stt_binary_handler_id === "number") {
                sttBinaryHandlerId = event.data.runner_data.stt_binary_handler_id;
                console.log(`Pipeline run-start: Using stt_binary_handler_id: ${sttBinaryHandlerId}`);
            } else {
                console.error(
                    "Pipeline run-start: stt_binary_handler_id not found or not a number in runner_data. Cannot send audio. Event data:",
                    event.data
                );
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
        case "stt-end":
            console.log("Pipeline event: 'stt-end'.", event);
            lastSTTAnimation(event.data.stt_output.text.trim());
            break;
        case "tts-start":
            console.log("Pipeline event: 'tts-start'", event.data);
            let ttsText = event.data.tts_input.trim();
            if (ttsText.includes("Provider")) {
                // error
                setVAState(STATE.IDLE); // Go back to idle
                panelAlert("AI Error. Please try again.");
                console.log(ttsText);
                return;
            }
            if (ttsText.includes(EXIT_MAGIC)) {
                setVAState(STATE.IDLE); // Go back to idle
                return;
            }
            if (ttsText.includes(REFRESH_MAGIC)) {
                setVAState(STATE.IDLE); // Go back to idle
                location.reload();
                return;
            }
            lastTTSAnimation(ttsText);
            break;
        case "tts-end":
            console.log(
                "Pipeline event: 'tts-end'. TTS Output URL:",
                event.data.tts_output ? event.data.tts_output.url : "N/A"
            );
            if (event.data.tts_output && event.data.tts_output.url) {
                const ttsUrl = (event.data.tts_output.url.startsWith("http") ? "" : HA_URL) + event.data.tts_output.url;
                if (store.vaState === STATE.SENDING_AUDIO || store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                    // Expecting TTS from these states
                    setVAState(STATE.PLAYING_TTS, ttsUrl);
                } else {
                    // console.warn(`TTS-END event received but not in SENDING_AUDIO/WAKE_WORD_TRIGGERED. State: ${getStateName(store.vaState)}. Playing TTS anyway.`);
                    // new Audio(ttsUrl).play().catch(e => console.error('Error playing TTS audio (fallback):', e));
                    // if (store.vaState !== STATE.IDLE && store.vaState !== STATE.PLAYING_TTS) { setVAState(STATE.IDLE); }
                }
            } else {
                // No TTS output, but tts stage / intent handling is done. If no run-end follows, this might be the end.
                console.log("TTS-END event with no TTS output URL. If no further events, pipeline might be considered ended.");
                // If 'run-end' is not guaranteed, we might need to transition to IDLE here.
                // For now, assuming 'run-end' is the definitive signal.
            }
            break;
        case "run-end":
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
        case "error":
            console.error("VA: HA Pipeline Error Event:", event.data.code, event.data.message);
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
        pipelineActive = false;
        resetAudioStreamingState();
        setVAState(STATE.IDLE);
    }
}

function sendHAStreamEnd() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN || !pipelineActive) {
        // Removed !haReadyForAudio here, as it might be false after sending last chunk
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
        pipelineActive = false;
        resetAudioStreamingState();
        setVAState(STATE.IDLE);
    }
}

function initiateHAPipelineRun() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
        console.warn("Cannot initiate HA pipeline: WebSocket not open.");
        panelAlert("Not connected to Home Assistant.");
        setVAState(STATE.IDLE);
        return;
    }
    if (pipelineActive) {
        // Should not happen if state logic is correct
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
        setVAState(STATE.IDLE);
        return;
    }

    console.log(`Initiating HA Assist Pipeline: ${HA_ASSIST_PIPELINE_NAME}`);
    resetAudioStreamingState(); // Prepare for new audio stream

    currentPipelineRunId = sendMessage({
        type: "assist_pipeline/run",
        start_stage: "stt",
        end_stage: "tts",
        input: { sample_rate: 16000 }, // Ensure VAD outputs this rate
        pipeline: HA_ASSIST_PIPELINE_NAME,
        conversation_id: conversationId
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
initializeApp().catch((initializationError) => {
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
        console.log("store.uiPollingTimestamp = now", "setInterval");
    }
    if (!store.mainUI) {
        store.mainUI = document.querySelector("html");
    }
    // if (!store.bgImage) {
    //     store.bgImage = document.getElementById("bg-image");
    // }
}, 1000);

document.querySelector("html").addEventListener("click", (e) => {
    // console.log('store.lastInteract = Date.now();')
    store.lastInteract = Date.now();
});

document.querySelector("html").addEventListener("touchstart", (e) => {
    // console.log('store.lastInteract = Date.now();')
    store.lastInteract = Date.now();
});

autorun(() => {
    store.updateBrightness();
});
