import pino from 'pino';
import { env, IS_PROD } from '../config/env.js';

// why: pretty logs in dev, structured JSON in prod for log aggregators
export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  redact: {
    // why: never leak secrets, OTPs, phone numbers, or tokens into logs
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.otp',
      '*.code',
      '*.codeHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.tokenHash',
      '*.phone',
    ],
    censor: '[redacted]',
  },
  transport: IS_PROD
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
});
