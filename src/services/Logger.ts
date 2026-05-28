export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug: (msg: string, ...rest: unknown[]) => void;
  info: (msg: string, ...rest: unknown[]) => void;
  warn: (msg: string, ...rest: unknown[]) => void;
  error: (msg: string, ...rest: unknown[]) => void;
  child: (scope: string) => Logger;
}

export function createLogger(opts: { level?: LogLevel; scope?: string } = {}): Logger {
  const level = opts.level ?? 'info';
  const scope = opts.scope;
  const min = LEVEL_ORDER[level];

  const emit = (lvl: LogLevel, msg: string, rest: unknown[]) => {
    if (LEVEL_ORDER[lvl] < min) return;
    const stamp = new Date().toISOString();
    const tag = scope ? `[${lvl}][${scope}]` : `[${lvl}]`;
    const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    stream.write(`${stamp} ${tag} ${msg}${rest.length ? ' ' + rest.map(formatExtra).join(' ') : ''}\n`);
  };

  return {
    debug: (msg, ...rest) => emit('debug', msg, rest),
    info: (msg, ...rest) => emit('info', msg, rest),
    warn: (msg, ...rest) => emit('warn', msg, rest),
    error: (msg, ...rest) => emit('error', msg, rest),
    child: (childScope: string) =>
      createLogger({ level, scope: scope ? `${scope}:${childScope}` : childScope }),
  };
}

function formatExtra(v: unknown): string {
  if (v instanceof Error) return v.stack ?? v.message;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
