import pino from 'pino';
import { getEnv } from './env.ts';

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined, // drop pid/hostname noise; one process per role anyway
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});

/** Child logger scoped to one audit run, so a sweep's lines can be grepped together. */
export function runLogger(auditRunId: string) {
  return logger.child({ auditRunId });
}

/** Child logger scoped to one PSI job. */
export function jobLogger(auditRunId: string, pageId: string, strategy: string) {
  return logger.child({ auditRunId, pageId, strategy });
}
