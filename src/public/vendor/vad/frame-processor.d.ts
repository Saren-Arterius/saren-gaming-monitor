import { Message } from "./messages";
import { SpeechProbabilities } from "./models";
export interface FrameProcessorOptions {
    /** Threshold over which values returned by the Silero VAD model will be considered as positively indicating speech.
     * The Silero VAD model is run on each frame. This number should be between 0 and 1.
     */
    positiveSpeechThreshold: number;
    /** Threshold under which values returned by the Silero VAD model will be considered as indicating an absence of speech.
     * Note that the creators of the Silero VAD have historically set this number at 0.15 less than `positiveSpeechThreshold`.
     */
    negativeSpeechThreshold: number;
    /** After a VAD value under the `negativeSpeechThreshold` is observed, the algorithm will wait `redemptionFrames` frames
     * before running `onSpeechEnd`. If the model returns a value over `positiveSpeechThreshold` during this grace period, then
     * the algorithm will consider the previously-detected "speech end" as having been a false negative.
     */
    redemptionFrames: number;
    /** Number of audio samples (under a sample rate of 16000) to comprise one "frame" to feed to the Silero VAD model.
     * The `frame` serves as a unit of measurement of lengths of audio segments and many other parameters are defined in terms of
     * frames. The authors of the Silero VAD model offer the following warning:
     * > WARNING! Silero VAD models were trained using 512, 1024, 1536 samples for 16000 sample rate and 256, 512, 768 samples for 8000 sample rate.
     * > Values other than these may affect model perfomance!!
     * In this context, audio fed to the VAD model always has sample rate 16000. It is probably a good idea to leave this at 1536.
     */
    frameSamples: number;
    /** Number of frames to prepend to the audio segment that will be passed to `onSpeechEnd`. */
    preSpeechPadFrames: number;
    /** If an audio segment is detected as a speech segment according to initial algorithm but it has fewer than `minSpeechFrames`,
     * it will be discarded and `onVADMisfire` will be run instead of `onSpeechEnd`.
     */
    minSpeechFrames: number;
    /**
     * If true, when the user pauses the VAD, it may trigger `onSpeechEnd`.
     */
    submitUserSpeechOnPause: boolean;
}
export declare const defaultLegacyFrameProcessorOptions: FrameProcessorOptions;
export declare const defaultV5FrameProcessorOptions: FrameProcessorOptions;
export declare function validateOptions(options: FrameProcessorOptions): void;
export interface FrameProcessorInterface {
    resume: () => void;
    process: (arr: Float32Array, handleEvent: (event: FrameProcessorEvent) => any) => Promise<any>;
    endSegment: (handleEvent: (event: FrameProcessorEvent) => any) => {
        msg?: Message;
        audio?: Float32Array;
    };
}
export declare class FrameProcessor implements FrameProcessorInterface {
    modelProcessFunc: (frame: Float32Array) => Promise<SpeechProbabilities>;
    modelResetFunc: () => any;
    options: FrameProcessorOptions;
    speaking: boolean;
    audioBuffer: {
        frame: Float32Array;
        isSpeech: boolean;
    }[];
    redemptionCounter: number;
    speechFrameCount: number;
    active: boolean;
    speechRealStartFired: boolean;
    constructor(modelProcessFunc: (frame: Float32Array) => Promise<SpeechProbabilities>, modelResetFunc: () => any, options: FrameProcessorOptions);
    reset: () => void;
    pause: (handleEvent: (event: FrameProcessorEvent) => any) => void;
    resume: () => void;
    endSegment: (handleEvent: (event: FrameProcessorEvent) => any) => {};
    process: (frame: Float32Array, handleEvent: (event: FrameProcessorEvent) => any) => Promise<void>;
}
export type FrameProcessorEvent = {
    msg: Message.VADMisfire;
} | {
    msg: Message.SpeechStart;
} | {
    msg: Message.SpeechRealStart;
} | {
    msg: Message.SpeechEnd;
    audio: Float32Array;
} | {
    msg: Message.FrameProcessed;
    probs: SpeechProbabilities;
    frame: Float32Array;
};
//# sourceMappingURL=frame-processor.d.ts.map