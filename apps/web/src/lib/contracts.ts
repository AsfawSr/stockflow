import { z } from 'zod';

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
});

export const sessionSchema = z.object({
  user: userSchema,
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime().refine((value) => Date.parse(value) > Date.now()),
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
export const membersSchema = z.array(
  z.object({
    user: userSchema,
    roles: z.array(roleSchema).min(1),
    createdAt: z.iso.datetime(),
  }),
);
export const emptySchema = z.null();
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

export type UserProfile = z.infer<typeof userSchema>;
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
