import type { NextRequest } from 'next/server';
import { exportFilters, proxyCsvExport } from '@/lib/export-proxy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const search = request.nextUrl.searchParams;
  return proxyCsvExport(organizationId, 'levels', {
    locationId: exportFilters.uuid(search.get('location')),
    low: search.get('show') === 'low' ? 'true' : null,
    search: search.get('search')?.trim().slice(0, 160) || null,
  });
}
