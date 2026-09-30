import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { apiRequest, type ApiResult } from './api-client';
import { cookieNames, privateCookieOptions } from './cookie-policy';
import { membershipSchema, organizationIdSchema, userSchema } from './contracts';

const production = process.env.NODE_ENV === 'production';
const names = cookieNames(production);
const options = privateCookieOptions(production);

export async function sessionToken(): Promise<string | undefined> {
  const token = (await cookies()).get(names.session)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

export async function saveSession(token: string, expiresAt: string) {
  const store = await cookies();
  store.set(names.session, token, { ...options, expires: new Date(expiresAt) });
  store.set(names.organization, '', { ...options, maxAge: 0 });
}

export async function clearSession() {
  const store = await cookies();
  store.set(names.session, '', { ...options, maxAge: 0 });
  store.set(names.organization, '', { ...options, maxAge: 0 });
}

export async function rememberOrganization(id: string) {
  (await cookies()).set(names.organization, organizationIdSchema.parse(id), {
    ...options,
    maxAge: 8 * 60 * 60,
  });
}

export async function rememberedOrganization() {
  const parsed = organizationIdSchema.safeParse((await cookies()).get(names.organization)?.value);
  return parsed.success ? parsed.data : undefined;
}

export async function authenticatedRequest<Data>(
  path: string,
  schema: z.ZodType<Data>,
  input: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<ApiResult<Data>> {
  const token = await sessionToken();
  if (!token) return { ok: false, status: 401, error: 'Sign in to continue.' };
  return apiRequest(path, schema, { ...input, token });
}

export const currentUser = cache(() => authenticatedRequest('/auth/me', userSchema));

export async function requireUser() {
  const result = await currentUser();
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  return result.data;
}

export async function actionRequest<Data>(
  path: string,
  schema: z.ZodType<Data>,
  input: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
) {
  const result = await authenticatedRequest(path, schema, input);
  if (!result.ok && result.status === 401) {
    await clearSession();
    redirect('/login?notice=expired');
  }
  return result;
}

export const requireOrganization = cache(async (id: string) => {
  if (!organizationIdSchema.safeParse(id).success) redirect('/organizations?notice=unavailable');
  await requireUser();
  const result = await authenticatedRequest(`/organizations/${id}`, membershipSchema);
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    if (result.status === 403 || result.status === 404)
      redirect('/organizations?notice=unavailable');
    throw new Error('The StockFlow API is unavailable.');
  }
  return result.data;
});
