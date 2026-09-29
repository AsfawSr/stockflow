type HealthResponse = {
  status: 'ok';
  service: 'stockflow-api';
};

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
