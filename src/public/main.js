const SMALL_WIDTH = 540;
const SMALL_HEIGHT = 420;
const POWERSAVE_MS = 60000;
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

const COLOR_SAFE = "#89e08b";
const COLOR_STOPS = [
    { color: "#70CAD1", position: 0 },
    { color: "#F7EE7F", position: 75 },
    { color: "#A63D40", position: 100 }
];
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

const Modal = ({ title, onClose, children, style }) => (
    <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-2xl transition-opacity duration-300"
        style={{ ...style, backgroundColor: 'rgba(0,0,0,0.2)' }}
        onClick={(e) => {
            store.lastInteract = Date.now();
            onClose(e);
        }}
    >
        <div
            className="w-[90%] max-w-3xl max-h-[90vh] bg-white/5 rounded-2xl flex flex-col overflow-hidden border border-white/10 shadow-2xl"
            onClick={(e) => {
                store.lastInteract = Date.now();
                e.stopPropagation();
            }}
        >
            <div className="p-5 border-b border-white/10 flex justify-between items-center">
                <div className="text-xl font-semibold text-white/90">{title}</div>
                <div className="cursor-pointer p-2 text-xl hover:text-accent transition-colors" onClick={onClose}>
                    ✕
                </div>
            </div>
            <div className="overflow-y-auto p-6 custom-scrollbar">{children}</div>
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
            motherboard: { max: 12000 }
        }
    };

    MH_FAN = true;

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

    vadState = '';
    mainUI = null;
    _lastInteract = Date.now();

    initInfo = null;
    storageModalTarget = null; // 'system' | 'storage' | null

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
        return 1;
        console.log("get mainUIBrightness");
        let mainUIBrightness = 1;
        const now = new Date(this.uiPollingTimestamp);
        const currentHour = now.getHours();
        if (currentHour >= NIGHT_H || currentHour < 6) {
            // Only dim mainUI between 10 PM and 6 AM
            const timeSinceLastInteract = (now.getTime() - this.lastInteract) / 1000; // in seconds
            if (timeSinceLastInteract <= 30) {
                mainUIBrightness = 1;
            } else if (timeSinceLastInteract > 30 && timeSinceLastInteract <= 90) {
                mainUIBrightness = 1 - ((timeSinceLastInteract - 30) / 60) * 0.7;
            } else {
                mainUIBrightness = 0.3; // Stays at 0.3 after 90 seconds of inactivity
            }
            console.log({ timeSinceLastInteract, mainUIBrightness });
        } else {
            mainUIBrightness = 1;
        }
        return Math.max(0, Math.min(1, mainUIBrightness));
    }

    updateBrightness() {
        if (!this.mainUI) return;
        console.log("updateBrightness");
        if (this.mainUI) {
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

    let i = Math.floor(Math.log(bytes) / Math.log(k));
    let formattedValue = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    if (formattedValue >= 1000) {
        i += 1;
        formattedValue = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    }
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

const ScrubMiniProgress = observer(({ storageKey, isSmallScreen, small }) => {
    if (!storageKey) return null;
    const storageData = store.storageInfo[storageKey];
    const scrub = storageData?.info?.metrics?.scrub;
    const showScrubProgress =
        scrub &&
        scrub.status !== "aborted" &&
        scrub.status !== "interrupted" &&
        scrub.status !== "none" &&
        scrub.scrubStarted &&
        Date.now() - scrub.scrubStarted < 48 * 3600 * 1000;

    if (!showScrubProgress) return null;

    return (
        <div
            style={{
                width: isSmallScreen ? "100%" : "80%",
                height: 4,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: 2,
                marginTop: 4,
                overflow: "hidden",
                position: "absolute",
                bottom: 10,
                left: isSmallScreen ? null : "10%"
            }}
        >
            <div
                style={{
                    width: `${scrub.progress}%`,
                    height: "100%",
                    backgroundColor:
                        scrub.status === "finished"
                            ? COLOR_SAFE
                            : scrub.status === "interrupted"
                                ? COLOR_STOPS[1].color
                                : COLOR_STOPS[0].color,
                    transition: "width 0.3s ease, background-color 0.3s ease"
                }}
            ></div>
        </div>
    );
});

const getGaugeSize = (isSmallScreen, small) => {
    return {
        width: isSmallScreen ? (small ? 100 : 100) : (small ? 170 : 170),
        height: isSmallScreen ? (small ? 100 : 100) : (small ? 150 : 150)
    }
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
    labelExtra,
    storageKey
}) => {
    useEffect(() => {
        feather.replace();
    }, []);

    let pct = ((value - min) / (max - min)) * 75;
    if (pct > 75) pct = 75;
    let iconColor = getColorAtPercent(pct / 0.75);
    let valueExtra = { usage: "%", temperature: "°C" }[className] || "";
    if (className === "io") value = formatBytes(value) + "/s";

    let isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;

    let labelExtras =
        (valueMB ? `${valueMB} MB` : "") +
        (valueGB ? `${valueGB} GB` : "") +
        (cpuFreq
            ? `${Math.round(Math.min(...store.frequencies.cpu))} - ${Math.round(Math.max(...store.frequencies.cpu))} ${isSmallScreen ? '' : 'Mhz'}`
            : "") +
        (gpuFreq ? `${store.frequencies.gpuCore} MHz` : "") +
        (gpuPwr ? `${store.pwr.gpu} W` : "") +
        (labelExtra || "");

    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (pct / 100) * circumference;

    let valueSize;
    if (store.windowWidth < 400) {
        valueSize = 16;
    } else if (isSmallScreen) {
        valueSize = 20;
    } else {
        valueSize = 32;
    }
    return (
        <div
            className={`group relative flex flex-col items-center justify-center transition-all duration-300 ${clickFn ? "cursor-pointer hover:scale-105 active:scale-95" : ""
                }`}
            style={getGaugeSize(isSmallScreen, small)}
            onClick={() => clickFn && clickFn()}
        >
            <svg className="absolute inset-0 w-full h-full -rotate-[225deg]" viewBox="0 0 100 100">
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={isSmallScreen ? '4' : "8"}
                    className="text-white/5"
                    strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
                    strokeLinecap="round"
                />
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={iconColor}
                    strokeWidth={isSmallScreen ? '4' : "8"}
                    strokeDasharray={circumference}
                    style={{
                        strokeDashoffset: strokeDashoffset,
                        transition: "stroke-dashoffset 1s ease, stroke 1s ease"
                    }}
                    strokeLinecap="round"
                />
            </svg>

            <div className="flex flex-col items-center justify-center z-10 text-center mt-2">
                <div className="mb-1 opacity-80 group-hover:opacity-100 transition-opacity" style={{ color: iconColor }}>
                    <i data-feather={featherName} className={`${isSmallScreen ? 'w-6 h-6' : 'w-8 h-8'}`}></i>
                </div>
                <div
                    className={`leading-none tracking-tighter text-[${valueSize}px]`}
                    style={{ color: textColor || 'white' }}
                >
                    {value}{valueExtra}{textExtra || ""}
                </div>
                <div
                    className={`mt-1 uppercase tracking-widest opacity-30 font-bold ${isSmallScreen ? 'text-[9px]' : 'text-[9px]'}`}
                    style={{ marginTop: -0 }}>
                    {label}
                </div>
                {(
                    <div
                        className={`${isSmallScreen ? 'text-[12px]' : 'text-[10px]'} opacity-20 font-medium uppercase tracking-tighter`}
                        style={{ marginTop: isSmallScreen ? -4 : -4 }}>
                        {labelExtras || '\u00A0'}
                    </div>
                )}
            </div>
            {className !== 'temperature' && <ScrubMiniProgress storageKey={storageKey} isSmallScreen={isSmallScreen} />}
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
                <div style={{ fontSize: "3em" }}>Connecting...</div>
            </div>
        );
    } else if (store.uiPollingTimestamp - store.firstDataPushedAt < 200) {
        shouldShow = true;
        content = (
            <div style={fullScreenOverlayStyle}>
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
                    src={ASSETS_HOST + "/vendor/ai.lottie"}
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
    zIndex: 10,
    top: 0,
    left: 0,
    transition: "opacity 0.3s ease-in-out"
};


const tabStyle = (isActive) => ({
    padding: "10px 15px",
    cursor: "pointer",
    borderBottom: isActive ? "2px solid #70CAD1" : "2px solid transparent",
    color: isActive ? "#70CAD1" : "#aaa",
    fontWeight: isActive ? "600" : "400",
    transition: "all 0.2s ease",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontSize: "0.85em",
    fontFamily: "system-ui, -apple-system, sans-serif",
});


const StorageModal = observer(() => {
    const section = store.storageModalTarget;
    const { shouldRender, style } = useModalTransition(!!section);

    if (!shouldRender) return null;

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

const InfoGrid = ({ items, isSmallScreen, noBorder }) => (
    <div
        style={{
            borderRadius: noBorder ? null : 8,
            overflow: "hidden",
            border: noBorder ? null : "1px solid rgba(255, 255, 255, 0.1)",
            padding: noBorder ? null : 15,
            display: "flex",
            flexDirection: isSmallScreen ? "column" : "row",
            flexWrap: "wrap",
            gap: 15
        }}
    >
        {items.map((item, i) => (
            <div key={i} style={{
                flex: isSmallScreen ? "1 1 100%" : "1 1 30%",
                minWidth: isSmallScreen ? null : "150px",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: 6,
                padding: "8px 12px",
                backgroundColor: "rgba(255, 255, 255, 0.02)",
                width: isSmallScreen ? 'calc(100%)' : null
            }}>
                <div style={{ fontSize: '0.7em', fontWeight: 600, opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'system-ui, -apple-system, sans-serif' }}>{item.label}</div>
                <div style={{ fontSize: '1.1em', fontWeight: 600, letterSpacing: '-0.02em', color: item.color || "inherit" }}>{item.value}</div>
            </div>
        ))}
    </div>
);

const StorageContent = observer(({ target }) => {
    if (!target) return null;
    const data = store.storageInfo[target];

    if (!data || !data.paths)
        return <div style={{ padding: 20 }}>No data.</div>;

    const info = data.info;
    const smart = info.metrics.smart;
    const fs = info.metrics.filesystem;
    const scrub = info.metrics.scrub;

    const isSmallScreen = store.windowWidth < SMALL_WIDTH || store.windowHeight < SMALL_HEIGHT;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {scrub && (
                <>
                    <div
                        style={{
                            marginBottom: 15,
                            borderRadius: 8,
                            overflow: "hidden",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            padding: 15,
                            display: "flex",
                            flexDirection: isSmallScreen ? "column" : "row",
                            gap: isSmallScreen ? 15 : 20
                        }}
                    >
                        <div style={{
                            flex: 1.5,
                            borderBottom: isSmallScreen && ((scrub.eta || scrub.timeLeft)) ? '1px solid #333' : 'none',
                            borderRight: !isSmallScreen && ((scrub.eta || scrub.timeLeft)) ? '1px solid #333' : 'none',
                            paddingRight: !isSmallScreen && ((scrub.eta || scrub.timeLeft)) ? 15 : 0,
                            paddingBottom: isSmallScreen && ((scrub.eta || scrub.timeLeft)) ? 15 : 0
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <i data-feather="refresh-cw" style={{ width: 14, height: 14, color: '#70CAD1', opacity: 0.8 }}></i>
                                <span style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scrub Progress</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <div style={{ fontSize: '1.2em', fontWeight: 700, color: '#70CAD1', fontFamily: 'monospace' }}>{scrub.progress.toFixed(2)}%</div>
                                <div style={{ fontSize: '1.1em', fontWeight: 700, color: scrub.status === 'finished' ? COLOR_SAFE : (scrub.status === 'interrupted' ? COLOR_STOPS[1].color : '#70CAD1'), fontFamily: 'monospace', textTransform: 'uppercase' }}>{scrub.status}</div>
                            </div>
                            <>
                                <div style={{ width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                                    <div style={{
                                        width: `${scrub.progress}%`,
                                        height: '100%',
                                        backgroundColor: scrub.status === 'finished' ? COLOR_SAFE : (scrub.status === 'interrupted' ? COLOR_STOPS[1].color : COLOR_STOPS[0].color),
                                        transition: 'width 0.3s ease, background-color 0.3s ease'
                                    }}></div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8, fontSize: '0.85em', color: '#eee', opacity: 0.8, fontWeight: 600 }}>
                                    <div>{scrub.rate.replace('iB', 'B')}</div>
                                    <div>{formatBytes(scrub.bytesScrubbed, 2, "B")} / {formatBytes(scrub.totalToScrub, 2, "B")}</div>
                                </div>
                            </>
                        </div>

                        {(scrub.eta || scrub.timeLeft) && (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, paddingLeft: isSmallScreen ? 0 : 5 }}>
                                <InfoGrid
                                    noBorder={true}
                                    isSmallScreen={isSmallScreen}
                                    items={[
                                        { label: "ETA", value: scrub.eta },
                                        { label: "Left", value: scrub.timeLeft },
                                    ]}
                                />
                            </div>
                        )}
                    </div>
                </>
            )}

            <h3
                style={{
                    borderBottom: "1px solid #444",
                    paddingBottom: 5,
                    marginTop: 15
                }}
            >
                Drive Health
            </h3>
            <InfoGrid
                isSmallScreen={isSmallScreen}
                items={[
                    { label: "Spare blocks", value: smart.spare.formatted },
                    { label: "Wear level", value: smart.wear.formatted },
                    { label: "Media errors", value: smart.mediaErrors.formatted },
                    { label: "Age", value: smart.powerOnTime.formatted },
                    ...[
                        smart.dataWritten.formatted !== 'N/A' ? { label: "Total written", value: smart.dataWritten.formatted } : null,
                        smart.dataRead.formatted !== 'N/A' ? { label: "Total read", value: smart.dataRead.formatted } : null
                    ].filter(s => s)
                ]}
            />

            <h3
                style={{
                    borderBottom: "1px solid #444",
                    paddingBottom: 5,
                    marginTop: 15
                }}
            >
                BTRFS Status
            </h3>
            <InfoGrid
                isSmallScreen={isSmallScreen}
                items={[
                    { label: "Write errors", value: fs.writeErrors, color: fs.writeErrors > 0 ? COLOR_STOPS[2].color : undefined },
                    { label: "Read errors", value: fs.readErrors, color: fs.readErrors > 0 ? COLOR_STOPS[2].color : undefined },
                    { label: "Flush errors", value: fs.flushErrors, color: fs.flushErrors > 0 ? COLOR_STOPS[2].color : undefined },
                    { label: "Corruption errors", value: fs.corruptionErrors, color: fs.corruptionErrors > 0 ? COLOR_STOPS[2].color : undefined },
                    { label: "Generation errors", value: fs.generationErrors, color: fs.generationErrors > 0 ? COLOR_STOPS[2].color : undefined }
                ]}
            />
        </div>
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
            className="fixed right-6 bottom-6 w-12 h-12 bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-xl cursor-pointer z-[100] transition-all duration-300 hover:scale-110 active:scale-90"
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

    const isUsingBackupNetwork = store.io.isUsingBackup;
    const systemSSD = store.disks['systemSSD'];
    let useSmall = true;
    return (
        <div className="min-h-screen bg-black text-white font-sans selection:bg-accent/30" style={{ width: '100%' }}>
            <div
                className={`mx-auto p-2 md:p-8 transition-all duration-1000 space-y-4 ${isSmallLandscape ? "flex flex-wrap max-w-none" : "max-w-4xl"
                    }`}
                style={{
                    filter: store.mainUI?.style.filter
                }}
            >
                {/* Temperature Section */}
                <div className={`flex flex-col ${isSmallLandscape ? "w-1/2 pr-4" : "w-full"}`}>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-2 flex items-center gap-2">
                        Temperature
                    </div>
                    <div className="flex justify-between">
                        <Gauge
                            small={useSmall}
                            value={store.temperatures.cpu}
                            min={store.GAUGE_LIMITS.temperature.cpu.min}
                            max={store.GAUGE_LIMITS.temperature.cpu.max}
                            label="CPU"
                            className="temperature"
                            featherName="cpu"
                        />
                        <Gauge
                            small={useSmall}
                            value={store.temperatures.gpu}
                            min={store.GAUGE_LIMITS.temperature.gpu.min}
                            max={store.GAUGE_LIMITS.temperature.gpu.max}
                            label="GPU"
                            className="temperature"
                            featherName="image"
                            gpuPwr
                        />
                        {Object.values(store.disks).map((disk) => (
                            <Gauge
                                small={useSmall}
                                key={disk.label}
                                value={disk.temperature}
                                min={disk.temperatureLimit.min}
                                max={disk.temperatureLimit.max}
                                label={`${disk.label.includes('HDD') ? 'HDD' : 'SSD'} (${disk.name})`}
                                className="temperature"
                                featherName="hard-drive"
                                storageKey={disk.label}
                                clickFn={() => (store.storageModalTarget = disk.label)}
                                textColor={STORAGE_TEXT_COLOR[store.storageInfo[disk.label]?.info?.status || 0]}
                                textExtra={STORAGE_EXTRA_TEXT[store.storageInfo[disk.label]?.info?.status || 0]}
                            />
                        ))}
                    </div>
                </div>

                {/* Usage Section */}
                <div className={`flex flex-col ${isSmallLandscape ? "w-1/2 pl-4" : "w-full"}`}>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-2 flex items-center gap-2">
                        Usage
                    </div>
                    <div className="flex justify-between">
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
                        <Gauge
                            value={store.usage.gpu}
                            max={100}
                            label="GPU"
                            className="usage"
                            featherName="image"
                            small
                            gpuFreq
                        />
                        <Gauge
                            value={store.usage.vram}
                            valueMB={store.usageMB.vram}
                            max={100}
                            label="VRAM"
                            className="usage"
                            featherName="monitor"
                            small
                        />
                    </div>
                </div>

                {/* I/O Section */}
                <div className={`flex flex-col ${isSmallLandscape ? "w-1/2 pr-4" : "w-full"}`}>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-2 flex items-center gap-2">
                        I/O
                    </div>
                    <div className="flex justify-between">
                        <Gauge
                            value={/*systemSSD ? systemSSD.diskRead : */store.io.diskRead}
                            max={store.GAUGE_LIMITS.io.diskRead.max}
                            label="System Read"
                            className="io"
                            featherName="book-open"
                            small
                        />
                        <Gauge
                            value={/*systemSSD ? systemSSD.diskWrite : */store.io.diskWrite}
                            max={store.GAUGE_LIMITS.io.diskWrite.max}
                            label="System Write"
                            className="io"
                            featherName="edit-3"
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
                            featherName="download"
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
                            featherName="upload"
                            small
                            textColor={isUsingBackupNetwork ? "#F7EE7F" : undefined}
                        />
                    </div>
                </div>

                {/* Storage Section */}
                <div className={`flex flex-col ${isSmallLandscape ? "w-1/2 pl-4" : "w-full"}`}>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-2 flex items-center gap-2">
                        Storage
                    </div>
                    <div className="flex justify-between">
                        {Object.values(store.disks).map((disk) => (
                            <Gauge
                                key={disk.label}
                                value={disk.usage}
                                valueGB={disk.usageGB}
                                max={100}
                                label={disk.name}
                                storageKey={disk.label}
                                className="usage"
                                featherName="hard-drive"
                                small
                                clickFn={() => (store.storageModalTarget = disk.label)}
                                textColor={STORAGE_TEXT_COLOR[store.storageInfo[disk.label]?.info?.status || 0]}
                                textExtra={STORAGE_EXTRA_TEXT[store.storageInfo[disk.label]?.info?.status || 0]}
                            />
                        ))}
                        {/* Fillers to maintain alignment if fewer than 4 disks */}
                        {Object.values(store.disks).length < 1 && <div style={getGaugeSize(isSmallScreen, true)}></div>}
                        {Object.values(store.disks).length < 2 && <div style={getGaugeSize(isSmallScreen, true)}></div>}
                        {Object.values(store.disks).length < 3 && <div style={getGaugeSize(isSmallScreen, true)}></div>}
                        {Object.values(store.disks).length < 4 && <div style={getGaugeSize(isSmallScreen, true)}></div>}
                    </div>
                </div>

                {/* Fan & System Info Section */}
                <div className={`flex ${isSmallLandscape ? "w-1/2 pl-4" : "w-full flex-col"} gap-4`}>
                    <div className="flex-1">
                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-2 flex items-center gap-2">
                            Fan Speed
                        </div>
                        <div className="flex justify-between">
                            <Gauge
                                value={store.fanSpeed.cpu}
                                max={store.GAUGE_LIMITS.fanSpeed.cpu.max}
                                small={true}
                                label="CPU RPM"
                                className="fan"
                                featherName="cpu"
                            />
                            <Gauge
                                value={store.fanSpeed.motherboard}
                                max={store.GAUGE_LIMITS.fanSpeed.motherboard.max}
                                label="Motherboard"
                                className="fan"
                                small={true}
                                featherName="server"
                            />
                            <div style={getGaugeSize(isSmallScreen, true)}></div>
                            <div style={getGaugeSize(isSmallScreen, true)}></div>
                        </div>
                    </div>

                    <div className="flex flex-col items-end justify-end text-right space-y-1 min-w-[200px]" style={{ marginTop: isSmallScreen ? -150 : -170 }}>
                        <div
                            className="text-2xl font-bold tracking-tighter"
                            style={{ color: COLOR_STOPS[loadLevel].color }}
                        >
                            {store.SYSTEM_INFO.hostname}
                        </div >
                        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold !leading-[12px]">{store.SYSTEM_INFO.cpu}</div>
                        {store.SYSTEM_INFO.gpu && <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold !leading-[12px]">{store.SYSTEM_INFO.gpu}</div>}
                        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold !leading-[12px]">{store.SYSTEM_INFO.case}</div>
                        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold !leading-[12px]">{store.SYSTEM_INFO.os}</div>
                        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold !leading-[12px]">{store.system?.split('|').join('·')}</div>
                        <div className="text-s text-white/60 mt-4">{getGMT8Time(store.lastUpdate)}</div>
                    </div >
                </div >



            </div >

            {!shouldPowerSave() && (
                <React.Fragment>
                    <StorageModal />
                    <AlertOverlay />
                </React.Fragment>
            )}
            <FullScreenStatus />
            <FullscreenButton />
        </div >
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
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        console.log("Microphone permission granted.");
    } catch (err) {
        console.error("Microphone permission denied:", err);
        panelAlert("Microphone access is required: " + err.message);
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
    panelAlert(
        null,
        <h1>
            <center>AI Reset Success</center>
        </h1>,
        3000
    );
}

async function handleHotword(hotwordDetails) {
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
                    handlePipelineEvent(message.event);
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
                onSpeechEnd: async (finalAudioBuffer) => {
                    // finalAudioBuffer is the ENTIRE utterance
                    console.log("VAD: Speech ended.");
                    if (myvad && myvad.listening) {
                        console.log("VAD: Speech ended, pausing VAD for this interaction.");
                        myvad.pause();
                    }
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
}, 1000);

document.querySelector("html").addEventListener("click", (e) => {
    // console.log('store.lastInteract = Date.now();')
    store.lastInteract = Date.now();
});

document.querySelector("html").addEventListener("touchstart", (e) => {
    // console.log('store.lastInteract = Date.now();')
    store.lastInteract = Date.now();
});
