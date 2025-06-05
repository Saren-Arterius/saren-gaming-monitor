import * as ortInstance from "onnxruntime-web";
import { FrameProcessor, FrameProcessorEvent, FrameProcessorOptions } from "./frame-processor";
import { OrtOptions, SpeechProbabilities } from "./models";
export declare const DEFAULT_MODEL = "legacy";
interface RealTimeVADCallbacks {
    /** Callback to run after each frame. The size (number of samples) of a frame is given by `frameSamples`. */
    onFrameProcessed: (probabilities: SpeechProbabilities, frame: Float32Array) => any;
    /** Callback to run if speech start was detected but `onSpeechEnd` will not be run because the
     * audio segment is smaller than `minSpeechFrames`.
     */
    onVADMisfire: () => any;
    /** Callback to run when speech start is detected */
    onSpeechStart: () => any;
    /**
     * Callback to run when speech end is detected.
     * Takes as arg a Float32Array of audio samples between -1 and 1, sample rate 16000.
     * This will not run if the audio segment is smaller than `minSpeechFrames`.
     */
    onSpeechEnd: (audio: Float32Array) => any;
    /** Callback to run when speech is detected as valid. (i.e. not a misfire) */
    onSpeechRealStart: () => any;
}
/**
 * Customizable audio constraints for the VAD.
 * Excludes certain constraints that are set for the user by default.
 */
type AudioConstraints = Omit<MediaTrackConstraints, "channelCount" | "echoCancellation" | "autoGainControl" | "noiseSuppression">;
type AssetOptions = {
    workletOptions: AudioWorkletNodeOptions;
    baseAssetPath: string;
    onnxWASMBasePath: string;
};
type ModelOptions = {
    model: "v5" | "legacy";
};
interface RealTimeVADOptionsWithoutStream extends FrameProcessorOptions, RealTimeVADCallbacks, OrtOptions, AssetOptions, ModelOptions {
    additionalAudioConstraints?: AudioConstraints;
    stream: undefined;
}
interface RealTimeVADOptionsWithStream extends FrameProcessorOptions, RealTimeVADCallbacks, OrtOptions, AssetOptions, ModelOptions {
    stream: MediaStream;
}
export declare const ort: typeof ortInstance;
export type RealTimeVADOptions = RealTimeVADOptionsWithStream | RealTimeVADOptionsWithoutStream;
export declare const getDefaultRealTimeVADOptions: (model: "v5" | "legacy") => RealTimeVADOptions;
export declare class MicVAD {
    options: RealTimeVADOptions;
    private audioContext;
    private stream;
    private audioNodeVAD;
    private sourceNode;
    private listening;
    static new(options?: Partial<RealTimeVADOptions>): Promise<MicVAD>;
    private constructor();
    pause: () => void;
    start: () => void;
    destroy: () => void;
    setOptions: (options: any) => void;
}
export declare class AudioNodeVAD {
    ctx: AudioContext;
    options: RealTimeVADOptions;
    private audioNode;
    private buffer?;
    private bufferIndex;
    private frameProcessor;
    private gainNode?;
    private resampler?;
    static new(ctx: AudioContext, options?: Partial<RealTimeVADOptions>): Promise<AudioNodeVAD>;
    constructor(ctx: AudioContext, options: RealTimeVADOptions, frameProcessor: FrameProcessor);
    private setupAudioNode;
    pause: () => void;
    start: () => void;
    receive: (node: AudioNode) => void;
    processFrame: (frame: Float32Array) => Promise<void>;
    handleFrameProcessorEvent: (ev: FrameProcessorEvent) => void;
    destroy: () => void;
    setFrameProcessorOptions: (options: any) => void;
}
export {};
//# sourceMappingURL=real-time-vad.d.ts.map