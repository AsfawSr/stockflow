import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditListSchema,
  invitationListSchema,
  invitationSchema,
  invitationsSchema,
  inviteInputSchema,
  memberListSchema,
  memberRolesInputSchema,
  memberSchema,
  membershipSchema,
  replyToEmailInputSchema,
} from '../src/lib/contracts';

const uuid = '8ed13b94-fd8b-4079-848e-f22edaa8ce05';

test('tracks the organization archive state in memberships', () => {
  const organization = {
    id: uuid,
    name: 'Archive Test',
    currency: 'USD',
    replyToEmail: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roles: ['ADMIN'],
  };
  assert.equal(membershipSchema.safeParse(organization).success, true);
  assert.equal(
    membershipSchema.safeParse({ ...organization, archivedAt: new Date().toISOString() }).success,
    true,
  );
  assert.equal(
    membershipSchema.safeParse({ ...organization, archivedAt: undefined }).success,
    false,
  );
});

test('normalizes the order reply-to email and stores blanks as null', () => {
  assert.equal(replyToEmailInputSchema.parse(' Purchasing@Orders.test '), 'purchasing@orders.test');
  assert.equal(replyToEmailInputSchema.parse('   '), null);
  assert.equal(replyToEmailInputSchema.safeParse('not-an-email').success, false);
});

test('validates paginated audit logs with nullable actors', () => {
  const event = {
    id: uuid,
    action: 'order.approved',
    entityType: 'purchase_order',
    entityId: uuid,
    summary: 'Approved purchase order PO-0001',
    actor: { id: uuid, displayName: 'Admin User' },
    createdAt: new Date().toISOString(),
  };
  assert.equal(
    auditListSchema.safeParse({ items: [event], total: 1, page: 1, pageSize: 20 }).success,
    true,
  );
  assert.equal(
    auditListSchema.safeParse({
      items: [{ ...event, actor: null, entityId: null }],
      total: 1,
      page: 1,
      pageSize: 20,
    }).success,
    true,
  );
  assert.equal(
    auditListSchema.safeParse({
      items: [{ ...event, summary: '' }],
      total: 1,
      page: 1,
      pageSize: 20,
    }).success,
    false,
  );
  assert.equal(auditListSchema.safeParse({ items: [event] }).success, false);
});

test('validates paginated member and invitation lists', () => {
  const member = {
    user: { id: uuid, email: 'colleague@example.test', displayName: 'Colleague' },
    roles: ['MANAGER'],
    createdAt: new Date().toISOString(),
  };
  const invitation = {
    id: uuid,
    email: 'colleague@example.test',
    roles: ['PURCHASER'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    invitedBy: { id: uuid, displayName: 'Admin User' },
  };
  assert.equal(
    memberListSchema.safeParse({ items: [member], total: 1, page: 1, pageSize: 20 }).success,
    true,
  );
  assert.equal(
    invitationListSchema.safeParse({ items: [invitation], total: 1, page: 1, pageSize: 20 })
      .success,
    true,
  );
  assert.equal(memberListSchema.safeParse([member]).success, false);
  assert.equal(
    memberListSchema.safeParse({ items: [member], total: -1, page: 1, pageSize: 20 }).success,
    false,
  );
});

test('normalizes invite input and requires at least one valid role', () => {
  assert.deepEqual(
    inviteInputSchema.parse({ email: ' Colleague@Example.TEST ', roles: ['MANAGER', 'WAREHOUSE'] }),
    { email: 'colleague@example.test', roles: ['MANAGER', 'WAREHOUSE'] },
  );
  for (const invalid of [
    { email: 'colleague@example.test', roles: [] },
    { email: 'colleague@example.test', roles: ['OWNER'] },
    { email: 'not-an-email', roles: ['MANAGER'] },
    { email: '', roles: ['MANAGER'] },
  ]) {
    assert.equal(inviteInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('validates invitation list responses', () => {
  const invitation = {
    id: uuid,
    email: 'colleague@example.test',
    roles: ['PURCHASER'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    invitedBy: { id: uuid, displayName: 'Admin User' },
  };
  assert.equal(invitationSchema.safeParse(invitation).success, true);
  assert.equal(invitationsSchema.safeParse([invitation]).success, true);
  assert.equal(invitationSchema.safeParse({ ...invitation, roles: [] }).success, false);
  assert.equal(invitationSchema.safeParse({ ...invitation, email: 'nope' }).success, false);
  assert.equal(
    invitationSchema.safeParse({ ...invitation, invitedBy: { id: uuid, displayName: '' } }).success,
    false,
  );
});

test('validates member responses and role updates', () => {
  const member = {
    user: { id: uuid, email: 'colleague@example.test', displayName: 'Colleague' },
    roles: ['MANAGER'],
    createdAt: new Date().toISOString(),
  };
  assert.equal(memberSchema.safeParse(member).success, true);
  assert.equal(memberSchema.safeParse({ ...member, roles: [] }).success, false);
  assert.deepEqual(memberRolesInputSchema.parse({ roles: ['ADMIN', 'WAREHOUSE'] }), {
    roles: ['ADMIN', 'WAREHOUSE'],
  });
  assert.equal(memberRolesInputSchema.safeParse({ roles: [] }).success, false);
  assert.equal(memberRolesInputSchema.safeParse({ roles: ['OWNER'] }).success, false);
});
