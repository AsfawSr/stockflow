import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestLogging } from '../src/common/request-logging';

type Entry = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

function run(options: { path: string; inboundId?: string; statusCode?: number }) {
  const logger = { log: jest.fn() } as unknown as Logger & { log: jest.Mock };
  const middleware = requestLogging(logger);
  const headers: Record<string, string> = {};
  let finish: (() => void) | undefined;
  const request = {
    method: 'GET',
    path: options.path,
    header: (name: string) =>
      name.toLowerCase() === 'x-request-id' ? options.inboundId : undefined,
  } as unknown as Request;
  const response = {
    statusCode: options.statusCode ?? 200,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    on: (event: string, callback: () => void) => {
      if (event === 'finish') finish = callback;
    },
  } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  middleware(request, response, next);
  finish?.();
  return { logger, headers, next };
}

describe('requestLogging', () => {
  it('generates a request id, echoes it, and logs one structured entry', () => {
    const { logger, headers, next } = run({ path: '/api/organizations', statusCode: 404 });
    expect(next).toHaveBeenCalledTimes(1);
    expect(headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.log).toHaveBeenCalledTimes(1);
    const entry = logger.log.mock.calls[0][0] as Entry;
    expect(entry).toMatchObject({
      requestId: headers['X-Request-Id'],
      method: 'GET',
      path: '/api/organizations',
      statusCode: 404,
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps a well-formed inbound request id and replaces hostile ones', () => {
    expect(run({ path: '/api/x', inboundId: 'trace-1.2_3' }).headers['X-Request-Id']).toBe(
      'trace-1.2_3',
    );
    for (const hostile of ['bad id', 'a'.repeat(65), 'line\nbreak', '"quoted"', '']) {
      const { headers } = run({ path: '/api/x', inboundId: hostile });
      expect(headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('never logs health probes but still tags them with a request id', () => {
    for (const path of ['/api/health', '/api/health/ready']) {
      const { logger, headers } = run({ path });
      expect(logger.log).not.toHaveBeenCalled();
      expect(headers['X-Request-Id']).toBeDefined();
    }
  });
});
