"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = exports.LOG_PREFIX = void 0;
exports.LOG_PREFIX = "[VAD]";
const levels = ["error", "debug", "warn"];
function getLog(level) {
    return (...args) => {
        console[level](exports.LOG_PREFIX, ...args);
    };
}
const _log = levels.reduce((acc, level) => {
    acc[level] = getLog(level);
    return acc;
}, {});
exports.log = _log;
//# sourceMappingURL=logging.js.map