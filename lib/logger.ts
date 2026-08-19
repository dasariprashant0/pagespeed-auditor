import pino, { type Logger } from 'pino';

/**
 * Lazily constructed.
 *
 * Building the logger at module scope meant calling getEnv() at import time, so
 * merely importing any module that logs demanded a fully valid environment --
 * which made `node --test` fail on modules that never log during a unit test.
 * A logger is infrastructure; it should not gate importability.
 */
let instance: Logger | undefined;

function build(): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const pretty = process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== '0';

  return pino({
    level,
    base: undefined, // drop pid/hostname noise; one process per role anyway
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}

/** Proxy so `logger.info(...)` works while construction stays deferred. */
export const logger: Logger = new Proxy({} as Logger, {
  get(_t, prop) {
    instance ??= build();
    const v = Reflect.get(instance, prop);
    return typeof v === 'function' ? v.bind(instance) : v;
  },
});

/** Child logger scoped to one audit run, so a sweep's lines can be grepped together. */
export function runLogger(auditRunId: string): Logger {
  instance ??= build();
  return instance.child({ auditRunId });
}

/** Child logger scoped to one PSI job. */
export function jobLogger(auditRunId: string, pageId: string, strategy: string): Logger {
  instance ??= build();
  return instance.child({ auditRunId, pageId, strategy });
}
