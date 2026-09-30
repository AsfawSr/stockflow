import { z } from 'zod';

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  emailVerifiedAt: z.iso.datetime().nullable(),
});

export const sessionSchema = z.object({
  user: userSchema,
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime().refine((value) => Date.parse(value) > Date.now()),
  verificationEmailSent: z.boolean().optional(),
});

export const roleSchema = z.enum(['ADMIN', 'PURCHASER', 'MANAGER', 'WAREHOUSE']);
export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const membershipSchema = organizationSchema.extend({ roles: z.array(roleSchema).min(1) });
export const organizationsSchema = z.array(membershipSchema);
export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  roles: z.array(roleSchema).min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  invitedBy: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
});
export const invitationsSchema = z.array(invitationSchema);
export const inviteInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ error: 'Enter a valid email address.' })),
  roles: z.array(roleSchema).min(1, 'Choose at least one role.'),
});
export const membersSchema = z.array(
  z.object({
    user: userSchema.omit({ emailVerifiedAt: true }),
    roles: z.array(roleSchema).min(1),
    createdAt: z.iso.datetime(),
  }),
);
export const emptySchema = z.null();
export const messageSchema = z.object({ message: z.string() });
export const accountTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const resetPasswordSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters.').max(128),
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords must match.',
  });
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: z.string().min(12, 'Use at least 12 characters.').max(128),
    confirmPassword: z.string(),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords must match.',
  });
export const organizationIdSchema = z.uuid();

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ error: 'Enter a valid email address.' })),
  password: z.string().min(1, 'Enter your password.').max(128),
});
export const signupSchema = loginSchema
  .extend({
    displayName: z.string().trim().min(1, 'Enter your name.').max(120),
    password: z.string().min(12, 'Use at least 12 characters.').max(128),
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords must match.',
  });
export const organizationInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter an organization name.').max(160),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency.'),
});

export const productSchema = z.object({
  id: z.uuid(),
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  unit: z.string().min(1),
  reorderPoint: z.number().int().nonnegative().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const productListSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const productInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Enter a SKU.')
    .max(64, 'Use at most 64 characters.')
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, digits, dots, underscores, or hyphens.'),
  name: z.string().trim().min(1, 'Enter a product name.').max(160),
  unit: z.string().trim().min(1, 'Enter a stock unit, such as piece or kg.').max(32),
  description: z
    .string()
    .trim()
    .max(2000, 'Use at most 2,000 characters.')
    .transform((value) => value || null),
  reorderPoint: z
    .string()
    .trim()
    .default('')
    .refine(
      (value) => value === '' || /^\d{1,7}$/.test(value),
      'Enter a whole number of 0 or more.',
    )
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || value <= 1000000, 'Use at most 1,000,000.'),
});
export const productStatusSchema = z.enum(['active', 'archived', 'all']);
export const catalogQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  status: productStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((value) => value || null);

export const supplierSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const supplierListSchema = z.object({
  items: z.array(supplierSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a supplier name.').max(160),
  contactName: optionalTrimmed(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Use at most 254 characters.')
    .transform((value) => value || null)
    .refine(
      (value) => value === null || z.email().safeParse(value).success,
      'Enter a valid email address.',
    ),
  phone: z
    .string()
    .trim()
    .max(32, 'Use at most 32 characters.')
    .transform((value) => value || null)
    .refine(
      (value) => value === null || /^(?=.*[0-9])[+0-9()./ -]{3,32}$/.test(value),
      'Enter a phone number using digits and + ( ) . / - separators.',
    ),
  address: optionalTrimmed(500),
});

export const locationSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  address: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const locationListSchema = z.object({
  items: z.array(locationSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const locationInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a location name.').max(120),
  address: optionalTrimmed(500),
});

export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
]);
const moneySchema = z.string().regex(/^\d+\.\d{2}$/);
const orderPartySchema = z.object({ id: z.uuid(), name: z.string().min(1) });
const orderUserSchema = z.object({ id: z.uuid(), displayName: z.string().min(1) });
const orderProductSchema = z.object({
  id: z.uuid(),
  sku: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
});
export const orderLineSchema = z.object({
  id: z.uuid(),
  product: orderProductSchema,
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  receivedQuantity: z.number().int().nonnegative(),
  remainingQuantity: z.number().int().nonnegative(),
  lineTotal: moneySchema,
});
export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  reference: z.string().min(1),
  status: purchaseOrderStatusSchema,
  note: z.string().nullable(),
  supplier: orderPartySchema,
  location: orderPartySchema,
  createdBy: orderUserSchema,
  decidedBy: orderUserSchema.nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  total: moneySchema,
  lines: z.array(orderLineSchema),
  receipts: z.array(
    z.object({
      id: z.uuid(),
      note: z.string().nullable(),
      receivedBy: orderUserSchema,
      createdAt: z.iso.datetime(),
      lines: z.array(
        z.object({
          id: z.uuid(),
          purchaseOrderLineId: z.uuid(),
          product: orderProductSchema,
          quantity: z.number().int().positive(),
        }),
      ),
    }),
  ),
});
export const purchaseOrderListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int().positive(),
      reference: z.string().min(1),
      status: purchaseOrderStatusSchema,
      supplier: orderPartySchema,
      location: orderPartySchema,
      lineCount: z.number().int().nonnegative(),
      total: moneySchema,
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const createOrderInputSchema = z.object({
  supplierId: z.uuid('Choose a supplier.'),
  locationId: z.uuid('Choose a destination location.'),
  note: optionalTrimmed(1000),
});
export const orderLineInputSchema = z.object({
  productId: z.uuid('Choose a product.'),
  quantity: z.coerce.number().int('Enter a whole number.').min(1, 'Enter a quantity.').max(1000000),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a price such as 25 or 25.50.'),
});
export const rejectInputSchema = z.object({
  note: z.string().trim().min(1, 'Explain why the order is rejected.').max(1000),
});

export const stockMovementTypeSchema = z.enum([
  'RECEIPT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
]);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;
export const movementTypeLabels: Record<StockMovementType, string> = {
  RECEIPT: 'Delivery',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  ADJUSTMENT: 'Adjustment',
};
export const movementTypeTone: Record<StockMovementType, 'online' | 'offline' | 'pending'> = {
  RECEIPT: 'online',
  TRANSFER_IN: 'online',
  TRANSFER_OUT: 'offline',
  ADJUSTMENT: 'pending',
};
export const stockLevelListSchema = z.object({
  items: z.array(
    z.object({
      product: orderProductSchema.extend({ reorderPoint: z.number().int().nullable() }),
      location: orderPartySchema,
      quantity: z.number().int().nonnegative(),
      low: z.boolean(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const stockMovementListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      type: stockMovementTypeSchema,
      quantity: z.number().int(),
      product: orderProductSchema,
      location: orderPartySchema,
      createdBy: orderUserSchema,
      createdAt: z.iso.datetime(),
      detail: z.string().nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const stockWriteResultSchema = z.object({
  id: z.uuid(),
  levels: z.array(z.object({ locationId: z.uuid(), quantity: z.number().int() })),
});
export const transferInputSchema = z
  .object({
    productId: z.uuid('Choose a product.'),
    fromLocationId: z.uuid('Choose a source location.'),
    toLocationId: z.uuid('Choose a destination location.'),
    quantity: z.coerce
      .number()
      .int('Enter a whole number.')
      .min(1, 'Enter a quantity of at least 1.')
      .max(1000000, 'Use at most 1,000,000.'),
    note: optionalTrimmed(500),
  })
  .refine((input) => input.fromLocationId !== input.toLocationId, {
    path: ['toLocationId'],
    message: 'Choose two different locations.',
  });
export const adjustmentInputSchema = z.object({
  productId: z.uuid('Choose a product.'),
  locationId: z.uuid('Choose a location.'),
  quantity: z.coerce
    .number()
    .int('Enter a whole number.')
    .min(-1000000, 'Use at least -1,000,000.')
    .max(1000000, 'Use at most 1,000,000.')
    .refine((value) => value !== 0, 'Enter a quantity other than zero.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Explain the adjustment.')
    .max(500, 'Use at most 500 characters.'),
});

export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

export const orderStatusLabels: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PARTIALLY_RECEIVED: 'Partially received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};
export const orderStatusTone: Record<PurchaseOrderStatus, 'online' | 'offline' | 'pending'> = {
  DRAFT: 'pending',
  SUBMITTED: 'pending',
  APPROVED: 'online',
  REJECTED: 'offline',
  PARTIALLY_RECEIVED: 'pending',
  RECEIVED: 'online',
  CANCELLED: 'offline',
};

export type UserProfile = z.infer<typeof userSchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type InventoryLocation = z.infer<typeof locationSchema>;
export type Product = z.infer<typeof productSchema>;
export type ProductList = z.infer<typeof productListSchema>;
export type ProductStatus = z.infer<typeof productStatusSchema>;
export type Organization = z.infer<typeof membershipSchema>;
export type Role = z.infer<typeof roleSchema>;
export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
};

export const roleLabels: Record<Role, string> = {
  ADMIN: 'Administrator',
  PURCHASER: 'Purchasing',
  MANAGER: 'Manager',
  WAREHOUSE: 'Warehouse',
};
