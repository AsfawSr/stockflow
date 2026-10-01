import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

// Correlates every response with a request id and emits one access log line.
export function requestLogging(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction) => {
    const inbound = request.header('x-request-id');
    const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    response.setHeader('X-Request-Id', requestId);
    // Health probes poll constantly and would drown real traffic.
    if (!request.path.startsWith('/api/health')) {
      const started = process.hrtime.bigint();
      response.on('finish', () => {
        logger.log({
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1000) / 1000,
        });
      });
    }
    next();
  };
}
