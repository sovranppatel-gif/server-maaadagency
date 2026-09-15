import { isProd } from "./env.js";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const ACTIVE = isProd ? LEVELS.info : LEVELS.debug;

const COLORS = { error: "\x1b[31m", warn: "\x1b[33m", info: "\x1b[36m", debug: "\x1b[90m" };
const RESET = "\x1b[0m";

function emit(level, msg, meta) {
  if (LEVELS[level] > ACTIVE) return;
  const time = new Date().toISOString();

  if (isProd) {
    // Structured single-line JSON: ready for any log aggregator.
    console[level === "debug" ? "log" : level](JSON.stringify({ time, level, msg, ...meta }));
    return;
  }
  const tag = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console[level === "debug" ? "log" : level](`${tag} ${msg}${extra}`);
}

export const logger = {
  error: (msg, meta) => emit("error", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  info: (msg, meta) => emit("info", msg, meta),
  debug: (msg, meta) => emit("debug", msg, meta),
};
