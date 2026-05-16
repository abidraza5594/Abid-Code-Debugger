/**
 * Minimal leveled logger. Avoids pulling in pino/winston for a single binary.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

export function createLogger(prefix: string): (level: LogLevel, msg: string, meta?: unknown) => void {
  const min = LEVEL_RANK[MIN] ?? LEVEL_RANK.info;
  return (level, msg, meta) => {
    if (LEVEL_RANK[level] < min) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${prefix}] ${msg}`;
    const out = meta !== undefined ? `${line} ${stringify(meta)}` : line;
    if (level === 'error') console.error(out);
    else if (level === 'warn') console.warn(out);
    else console.log(out);
  };
}

function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
