export declare const LOG_PREFIX = "[VAD]";
declare const levels: readonly ["error", "debug", "warn"];
type Level = (typeof levels)[number];
type LogFn = (...args: any) => void;
type Logger = Record<Level, LogFn>;
export declare const log: Logger;
export {};
//# sourceMappingURL=logging.d.ts.map