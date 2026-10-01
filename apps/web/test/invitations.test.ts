import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  invitationSchema,
  invitationsSchema,
  inviteInputSchema,
  memberRolesInputSchema,
  memberSchema,
} from '../src/lib/contracts';

const uuid = '8ed13b94-fd8b-4079-848e-f22edaa8ce05';

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
