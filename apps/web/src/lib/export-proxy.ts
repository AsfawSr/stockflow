import 'server-only';
import { organizationIdSchema } from './contracts';
import { sessionToken } from './session';

const uuid = (value: string | null) =>
  value && organizationIdSchema.safeParse(value).success ? value : null;

// Streams a CSV export from the API using the caller's session, never exposing the token.
export async function proxyCsvExport(
  organizationId: string,
  resource: 'levels' | 'movements',
  filters: Record<string, string | null>,
): Promise<Response> {
  const token = await sessionToken();
  if (!token || !organizationIdSchema.safeParse(organizationId).success) {
    return new Response('Not found.', { status: 404 });
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  try {
    const base = (process.env.API_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
    const upstream = await fetch(
      `${base}/api/organizations/${organizationId}/stock/${resource}/export?${query}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!upstream.ok) {
      return new Response('Export unavailable.', {
        status: upstream.status === 404 ? 404 : 502,
      });
    }
    return new Response(await upstream.text(), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="stock-${resource}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('Export unavailable.', { status: 502 });
  }
}

export const exportFilters = { uuid };
