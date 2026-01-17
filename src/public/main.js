const SMALL_WIDTH = 540;
const SMALL_HEIGHT = 420;
const POWERSAVE_MS = 60000;
const RELAX_BUFFER_MS = 995;

const COLOR_SAFE = "#89e08b";
const COLOR_STOPS = [
    { color: "#70CAD1", position: 0 },
    { color: "#F7EE7F", position: 50 },
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

const modalOverlayStyle = {
    display: "flex",
    width: "100%",
    height: "100%",
    position: "fixed",
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(24px)",
    backgroundColor: "rgba(0,0,0,0.8)",
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
    // Configuration Constants
    SYSTEM_INFO = {
        hostname: "PC",
        cpu: "AMD",
        case: "PC Case",
        os: "Linux"
    };

    GAUGE_LIMITS = {
        temperature: {
            cpu: { min: 30, max: 95 },
        },
        power: {
            battery: { max: 45 }
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
    };
    usage = {
        cpu: 34,
        ram: 35,
    };
    usageMB = {
        ram: 16384,
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
    };
    pwr = {
        battery: 0
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
                bottom: (isSmallScreen ? -36 : -20) - (small ? 30 : 0),
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
    if (className === "usage" && label === "Power") {
        valueExtra = " W";
    }
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
        (className === "usage" && label === "Power" ? `${value} W` : "") +
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
                        <ScrubMiniProgress storageKey={storageKey} isSmallScreen={isSmallScreen} small={small} />
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
            </div>
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
                width: isSmallScreen ? 'calc(100% - 26px)' : null
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

    let useSmall = Object.keys(store.disks).length >= 2;
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
                            small={useSmall}
                            value={store.temperatures.cpu}
                            min={store.GAUGE_LIMITS.temperature.cpu.min}
                            max={store.GAUGE_LIMITS.temperature.cpu.max}
                            label="CPU"
                            className="temperature"
                            featherName="cpu"
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
                        <Gauge
                            value={store.pwr.battery}
                            max={store.GAUGE_LIMITS.power.battery.max}
                            label="Power"
                            className="usage"
                            featherName="zap"
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
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.case}</div>
                            <div style={{ opacity: 0.5 }}>{store.SYSTEM_INFO.os}</div>
                            <div style={{ fontWeight: 500, opacity: 0.8 }}>{store.system}</div>
                            <div style={{ fontWeight: 600 }}>{getGMT8Time(store.lastUpdate)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {!shouldPowerSave() && (
                <>
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
