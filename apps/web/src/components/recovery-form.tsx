'use client';

import { useActionState, useEffect, useRef } from 'react';
import { ArrowLeft, KeyRound, MailCheck, Send } from 'lucide-react';
import Link from 'next/link';
import {
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
  verifyEmailAction,
} from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FieldError, FormFeedback, PasswordField, SubmitButton } from './form-controls';

export function VerificationRequestForm() {
  const [state, action] = useActionState(resendVerificationAction, {} as FormState);
  return (
    <form action={action} className="stacked-form">
      <FormFeedback state={state} />
      <SubmitButton pendingText="Requesting...">
        <Send size={17} aria-hidden="true" />
        Resend verification email
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {} as FormState);
  return (
    <>
      <div className="recovery-symbol">
        <KeyRound size={25} aria-hidden="true" />
      </div>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h1>Reset your password</h1>
      <form action={action} className="stacked-form recovery-form">
        <FormFeedback state={state} />
        <div className="form-field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={state.values?.email}
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          />
          <FieldError name="email" state={state} />
        </div>
        <SubmitButton pendingText="Requesting...">
          <Send size={17} aria-hidden="true" />
          Send reset link
        </SubmitButton>
      </form>
      <Link className="text-link recovery-back" href="/login">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to sign in
      </Link>
    </>
  );
}

export function AccountLinkForm({ mode }: { mode: 'verify' | 'reset' }) {
  const token = useRef('');
  useEffect(() => {
    const capture = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (value) token.current = value;
      window.history.replaceState(window.history.state, '', window.location.pathname);
    };
    capture();
    window.addEventListener('hashchange', capture);
    return () => window.removeEventListener('hashchange', capture);
  }, []);
  const [state, action] = useActionState(async (previous: FormState, form: FormData) => {
    form.set('token', token.current);
    return mode === 'verify'
      ? verifyEmailAction(previous, form)
      : resetPasswordAction(previous, form);
  }, {} as FormState);
  const verifying = mode === 'verify';
  return (
    <>
      <div className="recovery-symbol">
        {verifying ? (
          <MailCheck size={25} aria-hidden="true" />
        ) : (
          <KeyRound size={25} aria-hidden="true" />
        )}
      </div>
      <p className="eyebrow">{verifying ? 'EMAIL CONFIRMATION' : 'ACCOUNT RECOVERY'}</p>
      <h1>{verifying ? 'Verify your email' : 'Choose a new password'}</h1>
      <form action={action} className="stacked-form recovery-form">
        <FormFeedback state={state} />
        {!verifying && (
          <>
            <PasswordField name="password" label="New password" signup state={state} />
            <PasswordField name="confirmPassword" label="Confirm password" signup state={state} />
          </>
        )}
        <SubmitButton pendingText={verifying ? 'Verifying...' : 'Updating...'}>
          {verifying ? (
            <MailCheck size={17} aria-hidden="true" />
          ) : (
            <KeyRound size={17} aria-hidden="true" />
          )}
          {verifying ? 'Verify email' : 'Update password'}
        </SubmitButton>
      </form>
      <Link
        className="text-link recovery-back"
        href={verifying ? '/verify-email' : '/forgot-password'}
      >
        Request a new link
      </Link>
    </>
  );
}
