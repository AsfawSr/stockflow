import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePasswordSchema } from '../src/lib/contracts';

test('requires the current password and a matching, long replacement', () => {
  assert.equal(
    changePasswordSchema.safeParse({
      currentPassword: 'old passphrase',
      newPassword: 'a brand new passphrase',
      confirmPassword: 'a brand new passphrase',
    }).success,
    true,
  );
  for (const invalid of [
    {
      currentPassword: '',
      newPassword: 'a brand new passphrase',
      confirmPassword: 'a brand new passphrase',
    },
    { currentPassword: 'old passphrase', newPassword: 'short', confirmPassword: 'short' },
    {
      currentPassword: 'old passphrase',
      newPassword: 'a brand new passphrase',
      confirmPassword: 'different',
    },
    {
      currentPassword: 'old passphrase',
      newPassword: 'a'.repeat(129),
      confirmPassword: 'a'.repeat(129),
    },
  ]) {
    assert.equal(changePasswordSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});
