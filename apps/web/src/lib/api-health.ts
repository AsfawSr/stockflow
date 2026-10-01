type HealthResponse = {
  status: 'ok';
  service: 'stockflow-api';
};

export async function isDatabaseReady(): Promise<boolean> {
  try {
    const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
    const result = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (!result.ok) return false;

    const payload: unknown = await result.json();
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'status' in payload &&
      payload.status === 'ok' &&
      'service' in payload &&
      payload.service === 'stockflow-api' &&
      'database' in payload &&
      payload.database === 'connected'
    );
  } catch {
    return false;
  }
}

export type MailHealth = {
  known: boolean;
  degraded: boolean;
  sent: number;
  failed: number;
};

export async function getMailHealth(): Promise<MailHealth> {
  const unknown = { known: false, degraded: false, sent: 0, failed: 0 };
  try {
    const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
    const result = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health/mail`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!result.ok) return unknown;
    const payload: unknown = await result.json();
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'service' in payload &&
      payload.service === 'stockflow-api' &&
      'status' in payload &&
      (payload.status === 'ok' || payload.status === 'degraded') &&
      'sent' in payload &&
      typeof payload.sent === 'number' &&
      'failed' in payload &&
      typeof payload.failed === 'number'
    ) {
      return {
        known: true,
        degraded: payload.status === 'degraded',
        sent: payload.sent,
        failed: payload.failed,
      };
    }
    return unknown;
  } catch {
    return unknown;
  }
}

export type ApiHealth = {
  connected: boolean;
  checkedAt: string;
  durationMs: number;
  detail: string;
  response: HealthResponse | null;
};

export async function getApiHealth(): Promise<ApiHealth> {
  const startedAt = performance.now();
  let response: HealthResponse | null = null;
  let detail = 'Connection failed or timed out.';

  try {
    const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
    const result = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (!result.ok) {
      detail = `API returned HTTP ${result.status}.`;
    } else {
      const payload: unknown = await result.json();

      if (
        typeof payload === 'object' &&
        payload !== null &&
        'status' in payload &&
        payload.status === 'ok' &&
        'service' in payload &&
        payload.service === 'stockflow-api'
      ) {
        response = { status: 'ok', service: 'stockflow-api' };
        detail = 'Health check passed.';
      } else {
        detail = 'Unexpected health response.';
      }
    }
  } catch {
    detail = 'Connection failed or timed out.';
  }

  return {
    connected: response !== null,
    checkedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    detail,
    response,
  };
}
