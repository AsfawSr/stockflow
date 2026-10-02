import type { NextRequest } from 'next/server';
import { exportFilters, proxyCsvExport } from '@/lib/export-proxy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const search = request.nextUrl.searchParams;
  return proxyCsvExport(organizationId, 'movements', {
    productId: exportFilters.uuid(search.get('product')),
    locationId: exportFilters.uuid(search.get('location')),
  });
}
