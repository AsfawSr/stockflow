'use client';

import { useActionState } from 'react';
import { KeyRound } from 'lucide-react';
import { changePasswordAction } from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FormFeedback, PasswordField, SubmitButton } from './form-controls';

export function PasswordChangeForm() {
  const [state, action] = useActionState(changePasswordAction, {} as FormState);
  return (
    <form action={action} className="stacked-form account-form">
      <FormFeedback state={state} />
      <PasswordField name="currentPassword" label="Current password" signup={false} state={state} />
      <PasswordField name="newPassword" label="New password" signup state={state} />
      <PasswordField name="confirmPassword" label="Confirm new password" signup state={state} />
      <SubmitButton pendingText="Updating...">
        <KeyRound size={17} aria-hidden="true" />
        Update password
      </SubmitButton>
    </form>
  );
}
