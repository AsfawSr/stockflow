import type { z } from 'zod';

export type ApiResult<Data> =
  { ok: true; data: Data; status: number } | { ok: false; status: number; error: string };

function errorMessage(status: number): string {
  if (status === 400) return 'Check the submitted details and try again.';
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'You do not have permission for this action.';
  if (status === 404) return 'This organization is no longer available to you.';
  if (status === 409) return 'An account could not be created with these details.';
  if (status === 423) return 'This organization is archived and read-only.';
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  return 'StockFlow is temporarily unavailable. Please try again.';
}

export async function apiRequest<Data>(
  path: string,
  schema: z.ZodType<Data>,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    token?: string;
    body?: unknown;
  } = {},
): Promise<ApiResult<Data>> {
  try {
    const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
    const headers = new Headers({ Accept: 'application/json' });
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${base.replace(/\/$/, '')}/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      return { ok: false, status: response.status, error: errorMessage(response.status) };
    const payload: unknown = response.status === 204 ? null : await response.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return { ok: false, status: 502, error: errorMessage(502) };
    return { ok: true, status: response.status, data: parsed.data };
  } catch {
    return { ok: false, status: 503, error: errorMessage(503) };
  }
}
