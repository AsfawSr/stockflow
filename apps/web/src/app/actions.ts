'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api-client';
import {
  emptySchema,
  loginSchema,
  membershipSchema,
  organizationIdSchema,
  organizationInputSchema,
  organizationSchema,
  sessionSchema,
  signupSchema,
  type FormState,
} from '@/lib/contracts';
import {
  actionRequest,
  clearSession,
  rememberOrganization,
  saveSession,
  sessionToken,
} from '@/lib/session';

export async function loginAction(_previous: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  const values = { email: String(form.get('email') ?? '') };
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await apiRequest('/auth/login', sessionSchema, {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok)
    return {
      error: result.status === 401 ? 'Email or password is incorrect.' : result.error,
      values,
    };
  await saveSession(result.data.accessToken, result.data.expiresAt);
  redirect('/organizations');
}

export async function signupAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = {
    email: String(form.get('email') ?? ''),
    displayName: String(form.get('displayName') ?? ''),
  };
  const parsed = signupSchema.safeParse({
    ...values,
    password: form.get('password'),
    confirmPassword: form.get('confirmPassword'),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const { email, password, displayName } = parsed.data;
  const result = await apiRequest('/auth/register', sessionSchema, {
    method: 'POST',
    body: { email, password, displayName },
  });
  if (!result.ok) return { error: result.error, values };
  await saveSession(result.data.accessToken, result.data.expiresAt);
  redirect('/organizations');
}

export async function logoutAction(): Promise<void> {
  const token = await sessionToken();
  const result = token
    ? await apiRequest('/auth/logout', emptySchema, { method: 'POST', token })
    : null;
  await clearSession();
  redirect(
    result && !result.ok && result.status !== 401
      ? '/login?notice=logout-unconfirmed'
      : '/login?notice=signed-out',
  );
}

export async function createOrganizationAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const values = {
    name: String(form.get('name') ?? ''),
    currency: String(form.get('currency') ?? ''),
  };
  const parsed = organizationInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest('/organizations', organizationSchema, {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return { error: result.error, values };
  await rememberOrganization(result.data.id);
  revalidatePath('/organizations');
  redirect(`/workspace/${result.data.id}`);
}

export async function selectOrganizationAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!parsed.success) return { error: 'Choose a valid organization.' };
  const result = await actionRequest(`/organizations/${parsed.data}`, membershipSchema);
  if (!result.ok) return { error: result.error };
  await rememberOrganization(result.data.id);
  redirect(`/workspace/${result.data.id}`);
}

export async function renameOrganizationAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = organizationIdSchema.safeParse(form.get('organizationId'));
  const parsed = organizationInputSchema.pick({ name: true }).safeParse({ name: form.get('name') });
  if (!id.success) return { error: 'Choose a valid organization.' };
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const result = await actionRequest(`/organizations/${id.data}`, organizationSchema, {
    method: 'PATCH',
    body: parsed.data,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath('/organizations');
  revalidatePath(`/workspace/${id.data}`);
  return { success: 'Organization updated.' };
}
