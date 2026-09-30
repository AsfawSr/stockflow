'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api-client';
import {
  emptySchema,
  accountTokenSchema,
  messageSchema,
  resetPasswordSchema,
  changePasswordSchema,
  loginSchema,
  invitationSchema,
  inviteInputSchema,
  locationInputSchema,
  locationSchema,
  membershipSchema,
  organizationIdSchema,
  organizationInputSchema,
  organizationSchema,
  productInputSchema,
  productSchema,
  createOrderInputSchema,
  orderLineInputSchema,
  purchaseOrderSchema,
  rejectInputSchema,
  adjustmentInputSchema,
  stockWriteResultSchema,
  transferInputSchema,
  sessionSchema,
  signupSchema,
  supplierInputSchema,
  supplierSchema,
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
  redirect(result.data.user.emailVerifiedAt ? '/organizations' : '/verify-email');
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
  redirect(
    result.data.verificationEmailSent ? '/verify-email' : '/verify-email?notice=delivery-failed',
  );
}

export async function resendVerificationAction(): Promise<FormState> {
  const result = await actionRequest('/auth/email/verification', messageSchema, { method: 'POST' });
  return result.ok
    ? { success: 'Verification link requested. Check your email.' }
    : { error: result.error };
}

export async function verifyEmailAction(_previous: FormState, form: FormData): Promise<FormState> {
  const token = accountTokenSchema.safeParse(form.get('token'));
  if (!token.success) return { error: 'This link is invalid or expired. Request a new link.' };
  const result = await apiRequest('/auth/email/verify', messageSchema, {
    method: 'POST',
    body: { token: token.data },
  });
  if (!result.ok)
    return {
      error:
        result.status === 400
          ? 'This link is invalid or expired. Request a new link.'
          : result.error,
    };
  revalidatePath('/');
  redirect('/login?notice=email-verified');
}

export async function requestPasswordResetAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const email = loginSchema.shape.email.safeParse(form.get('email'));
  if (!email.success) return { fieldErrors: { email: ['Enter a valid email address.'] } };
  const result = await apiRequest('/auth/password/reset-request', messageSchema, {
    method: 'POST',
    body: { email: email.data },
  });
  return result.ok
    ? { success: 'If an account exists for this address, a reset link will be sent.' }
    : { error: result.error, values: { email: email.data } };
}

export async function resetPasswordAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const token = accountTokenSchema.safeParse(form.get('token'));
  if (!token.success) return { error: 'This link is invalid or expired. Request a new link.' };
  const parsed = resetPasswordSchema.safeParse({
    password: form.get('password'),
    confirmPassword: form.get('confirmPassword'),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const result = await apiRequest('/auth/password/reset', messageSchema, {
    method: 'POST',
    body: { token: token.data, password: parsed.data.password },
  });
  if (!result.ok)
    return {
      error:
        result.status === 400
          ? 'This link is invalid or expired. Request a new link.'
          : result.error,
    };
  await clearSession();
  redirect('/login?notice=password-reset');
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

const duplicateSkuMessage = 'This SKU is already used in this organization.';

function productFormValues(form: FormData) {
  return {
    sku: String(form.get('sku') ?? ''),
    name: String(form.get('name') ?? ''),
    unit: String(form.get('unit') ?? ''),
    description: String(form.get('description') ?? ''),
    reorderPoint: String(form.get('reorderPoint') ?? ''),
  };
}

export async function createProductAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!organizationId.success) return { error: 'Choose a valid organization.' };
  const values = productFormValues(form);
  const parsed = productInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/products`,
    productSchema,
    {
      method: 'POST',
      body: parsed.data,
    },
  );
  if (!result.ok)
    return { error: result.status === 409 ? duplicateSkuMessage : result.error, values };
  revalidatePath(`/workspace/${organizationId.data}/products`);
  return { success: 'Product created.' };
}

export async function updateProductAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const productId = organizationIdSchema.safeParse(form.get('productId'));
  if (!organizationId.success || !productId.success)
    return { error: 'This product is no longer available.' };
  const values = productFormValues(form);
  const parsed = productInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/products/${productId.data}`,
    productSchema,
    { method: 'PATCH', body: parsed.data },
  );
  if (!result.ok)
    return { error: result.status === 409 ? duplicateSkuMessage : result.error, values };
  revalidatePath(`/workspace/${organizationId.data}/products`);
  return { success: 'Product updated.' };
}

export async function setProductArchivedAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const productId = organizationIdSchema.safeParse(form.get('productId'));
  const archive = form.get('archive') === 'true';
  if (!organizationId.success || !productId.success)
    return { error: 'This product is no longer available.' };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/products/${productId.data}/${archive ? 'archive' : 'restore'}`,
    productSchema,
    { method: 'POST' },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'This product was already changed. Refresh and try again.'
          : result.error,
    };
  revalidatePath(`/workspace/${organizationId.data}/products`);
  return { success: archive ? 'Product archived.' : 'Product restored.' };
}

const entityConfig = {
  supplier: {
    path: 'suppliers',
    schema: supplierSchema,
    input: supplierInputSchema,
    fields: ['name', 'contactName', 'email', 'phone', 'address'],
    duplicate: 'This supplier name is already used in this organization.',
  },
  location: {
    path: 'locations',
    schema: locationSchema,
    input: locationInputSchema,
    fields: ['name', 'address'],
    duplicate: 'This location name is already used in this organization.',
  },
} as const;

async function saveEntity(kind: keyof typeof entityConfig, form: FormData): Promise<FormState> {
  const setup = entityConfig[kind];
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!organizationId.success) return { error: 'Choose a valid organization.' };
  const rawId = form.get('entityId');
  const entityId = rawId === null ? null : organizationIdSchema.safeParse(rawId);
  if (entityId && !entityId.success) return { error: `This ${kind} is no longer available.` };
  const values = Object.fromEntries(
    setup.fields.map((field) => [field, String(form.get(field) ?? '')]),
  );
  const parsed = setup.input.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const base = `/organizations/${organizationId.data}/${setup.path}`;
  const result = await actionRequest(entityId ? `${base}/${entityId.data}` : base, setup.schema, {
    method: entityId ? 'PATCH' : 'POST',
    body: parsed.data,
  });
  if (!result.ok) return { error: result.status === 409 ? setup.duplicate : result.error, values };
  revalidatePath(`/workspace/${organizationId.data}/${setup.path}`);
  return { success: entityId ? 'Changes saved.' : 'Created.' };
}

async function toggleEntity(kind: keyof typeof entityConfig, form: FormData): Promise<FormState> {
  const setup = entityConfig[kind];
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const entityId = organizationIdSchema.safeParse(form.get('entityId'));
  const archive = form.get('archive') === 'true';
  if (!organizationId.success || !entityId.success)
    return { error: `This ${kind} is no longer available.` };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/${setup.path}/${entityId.data}/${archive ? 'archive' : 'restore'}`,
    setup.schema,
    { method: 'POST' },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? `This ${kind} was already changed. Refresh and try again.`
          : result.error,
    };
  revalidatePath(`/workspace/${organizationId.data}/${setup.path}`);
  return { success: archive ? 'Archived.' : 'Restored.' };
}

export async function saveSupplierAction(_previous: FormState, form: FormData): Promise<FormState> {
  return saveEntity('supplier', form);
}

export async function setSupplierArchivedAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return toggleEntity('supplier', form);
}

export async function saveLocationAction(_previous: FormState, form: FormData): Promise<FormState> {
  return saveEntity('location', form);
}

export async function setLocationArchivedAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return toggleEntity('location', form);
}

export async function createPurchaseOrderAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!organizationId.success) return { error: 'Choose a valid organization.' };
  const values = {
    supplierId: String(form.get('supplierId') ?? ''),
    locationId: String(form.get('locationId') ?? ''),
    note: String(form.get('note') ?? ''),
  };
  const parsed = createOrderInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/purchase-orders`,
    purchaseOrderSchema,
    { method: 'POST', body: parsed.data },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'The chosen supplier or location is archived. Refresh and choose active ones.'
          : result.error,
      values,
    };
  revalidatePath(`/workspace/${organizationId.data}/purchase-orders`);
  redirect(`/workspace/${organizationId.data}/purchase-orders/${result.data.id}`);
}

function orderPaths(organizationId: string, orderId: string) {
  return [
    `/workspace/${organizationId}/purchase-orders`,
    `/workspace/${organizationId}/purchase-orders/${orderId}`,
  ];
}

export async function addOrderLineAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const orderId = organizationIdSchema.safeParse(form.get('orderId'));
  if (!organizationId.success || !orderId.success)
    return { error: 'This order is no longer available.' };
  const values = {
    productId: String(form.get('productId') ?? ''),
    quantity: String(form.get('quantity') ?? ''),
    unitPrice: String(form.get('unitPrice') ?? ''),
  };
  const parsed = orderLineInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/purchase-orders/${orderId.data}/lines`,
    purchaseOrderSchema,
    { method: 'POST', body: parsed.data },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'The product is already on the order, is archived, or the order is no longer a draft.'
          : result.error,
      values,
    };
  for (const path of orderPaths(organizationId.data, orderId.data)) revalidatePath(path);
  return { success: 'Line added.' };
}

export async function removeOrderLineAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const orderId = organizationIdSchema.safeParse(form.get('orderId'));
  const lineId = organizationIdSchema.safeParse(form.get('lineId'));
  if (!organizationId.success || !orderId.success || !lineId.success)
    return { error: 'This order line is no longer available.' };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/purchase-orders/${orderId.data}/lines/${lineId.data}`,
    purchaseOrderSchema,
    { method: 'DELETE' },
  );
  if (!result.ok)
    return {
      error: result.status === 409 ? 'Lines can only be changed on draft orders.' : result.error,
    };
  for (const path of orderPaths(organizationId.data, orderId.data)) revalidatePath(path);
  return { success: 'Line removed.' };
}

const orderTransitions = {
  submit: 'Order submitted for approval.',
  approve: 'Order approved.',
  cancel: 'Order cancelled.',
} as const;

export async function transitionOrderAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const orderId = organizationIdSchema.safeParse(form.get('orderId'));
  const transition = String(form.get('transition') ?? '') as keyof typeof orderTransitions;
  if (!organizationId.success || !orderId.success || !(transition in orderTransitions))
    return { error: 'This order is no longer available.' };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/purchase-orders/${orderId.data}/${transition}`,
    purchaseOrderSchema,
    { method: 'POST', body: {} },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'This order changed state. Refresh the page and try again.'
          : result.error,
    };
  for (const path of orderPaths(organizationId.data, orderId.data)) revalidatePath(path);
  return { success: orderTransitions[transition] };
}

export async function rejectOrderAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const orderId = organizationIdSchema.safeParse(form.get('orderId'));
  if (!organizationId.success || !orderId.success)
    return { error: 'This order is no longer available.' };
  const parsed = rejectInputSchema.safeParse({ note: form.get('note') });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/purchase-orders/${orderId.data}/reject`,
    purchaseOrderSchema,
    { method: 'POST', body: parsed.data },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'This order changed state. Refresh the page and try again.'
          : result.error,
    };
  for (const path of orderPaths(organizationId.data, orderId.data)) revalidatePath(path);
  return { success: 'Order rejected.' };
}

export async function receiveOrderAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const orderId = organizationIdSchema.safeParse(form.get('orderId'));
  if (!organizationId.success || !orderId.success)
    return { error: 'This order is no longer available.' };
  const lines: { purchaseOrderLineId: string; quantity: number }[] = [];
  for (const [key, raw] of form.entries()) {
    if (!key.startsWith('quantity-')) continue;
    const lineId = organizationIdSchema.safeParse(key.slice('quantity-'.length));
    const value = String(raw).trim();
    if (!lineId.success || value === '') continue;
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 0)
      return { error: 'Quantities must be whole numbers.' };
    if (quantity > 0) lines.push({ purchaseOrderLineId: lineId.data, quantity });
  }
  if (lines.length === 0) return { error: 'Enter at least one received quantity.' };
  const note = String(form.get('note') ?? '').trim();
  const result = await actionRequest(
    `/organizations/${organizationId.data}/purchase-orders/${orderId.data}/receipts`,
    purchaseOrderSchema,
    { method: 'POST', body: { note: note || null, lines } },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'The receipt no longer matches the remaining quantities. Refresh and try again.'
          : result.error,
    };
  for (const path of orderPaths(organizationId.data, orderId.data)) revalidatePath(path);
  return { success: 'Delivery recorded.' };
}

export async function createTransferAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!organizationId.success) return { error: 'Choose a valid organization.' };
  const values = {
    productId: String(form.get('productId') ?? ''),
    fromLocationId: String(form.get('fromLocationId') ?? ''),
    toLocationId: String(form.get('toLocationId') ?? ''),
    quantity: String(form.get('quantity') ?? ''),
    note: String(form.get('note') ?? ''),
  };
  const parsed = transferInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/stock/transfers`,
    stockWriteResultSchema,
    { method: 'POST', body: parsed.data },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'Not enough stock at the source, or the destination is unavailable. Refresh and try again.'
          : result.error,
      values,
    };
  revalidatePath(`/workspace/${organizationId.data}/stock`);
  return { success: 'Transfer recorded.' };
}

export async function createAdjustmentAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!organizationId.success) return { error: 'Choose a valid organization.' };
  const values = {
    productId: String(form.get('productId') ?? ''),
    locationId: String(form.get('locationId') ?? ''),
    quantity: String(form.get('quantity') ?? ''),
    reason: String(form.get('reason') ?? ''),
  };
  const parsed = adjustmentInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/stock/adjustments`,
    stockWriteResultSchema,
    { method: 'POST', body: parsed.data },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'The adjustment would take stock below zero. Refresh and try again.'
          : result.error,
      values,
    };
  revalidatePath(`/workspace/${organizationId.data}/stock`);
  return { success: 'Adjustment recorded.' };
}

export async function inviteMemberAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  if (!organizationId.success) return { error: 'Choose a valid organization.' };
  const values = { email: String(form.get('email') ?? '') };
  const parsed = inviteInputSchema.safeParse({
    email: values.email,
    roles: form.getAll('roles').map(String),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/invitations`,
    invitationSchema,
    { method: 'POST', body: parsed.data },
  );
  if (!result.ok)
    return {
      error:
        result.status === 409
          ? 'This person is already a member.'
          : result.status === 503
            ? 'The invitation email could not be sent. Try again.'
            : result.error,
      values,
    };
  revalidatePath(`/workspace/${organizationId.data}`);
  return { success: 'Invitation sent.' };
}

export async function revokeInvitationAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const organizationId = organizationIdSchema.safeParse(form.get('organizationId'));
  const invitationId = organizationIdSchema.safeParse(form.get('invitationId'));
  if (!organizationId.success || !invitationId.success)
    return { error: 'This invitation is no longer available.' };
  const result = await actionRequest(
    `/organizations/${organizationId.data}/invitations/${invitationId.data}`,
    emptySchema,
    { method: 'DELETE' },
  );
  if (!result.ok && result.status !== 404) return { error: result.error };
  revalidatePath(`/workspace/${organizationId.data}`);
  return { success: 'Invitation revoked.' };
}

export async function acceptInvitationAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const token = accountTokenSchema.safeParse(form.get('token'));
  if (!token.success)
    return { error: 'This invitation link is incomplete. Open it from your email again.' };
  const result = await actionRequest('/invitations/accept', membershipSchema, {
    method: 'POST',
    body: { token: token.data },
  });
  if (!result.ok)
    return {
      error:
        result.status === 400
          ? 'This invitation is invalid or expired. Ask for a new one.'
          : result.status === 403
            ? 'This invitation was issued for a different email address. Sign in with the invited email.'
            : result.status === 409
              ? 'You are already a member of this organization.'
              : result.error,
    };
  await rememberOrganization(result.data.id);
  revalidatePath('/organizations');
  redirect(`/workspace/${result.data.id}`);
}

export async function changePasswordAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: form.get('currentPassword'),
    newPassword: form.get('newPassword'),
    confirmPassword: form.get('confirmPassword'),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const result = await actionRequest('/auth/password/change', messageSchema, {
    method: 'POST',
    body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword },
  });
  if (!result.ok)
    return {
      error: result.status === 400 ? 'Your current password is incorrect.' : result.error,
    };
  return { success: 'Password updated. Your other sessions were signed out.' };
}
