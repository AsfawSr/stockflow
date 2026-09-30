'use client';

import { useActionState } from 'react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { loginAction, signupAction } from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FieldError, FormFeedback, PasswordField, SubmitButton } from './form-controls';

export function AuthForm({ mode, notice }: { mode: 'login' | 'signup'; notice?: string }) {
  const signup = mode === 'signup';
  const [state, action] = useActionState(signup ? signupAction : loginAction, {} as FormState);
  return (
    <>
      <p className="eyebrow">YOUR STOCKFLOW ACCOUNT</p>
      <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
      <nav className="auth-tabs" aria-label="Account access">
        <Link href="/login" aria-current={!signup ? 'page' : undefined}>
          Sign in
        </Link>
        <Link href="/signup" aria-current={signup ? 'page' : undefined}>
          Create account
        </Link>
      </nav>
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
      <form action={action} className="stacked-form">
        <FormFeedback state={state} />
        {signup && (
          <div className="form-field">
            <label htmlFor="displayName">Full name</label>
            <input
              id="displayName"
              name="displayName"
              autoComplete="name"
              required
              maxLength={120}
              defaultValue={state.values?.displayName}
              aria-invalid={Boolean(state.fieldErrors?.displayName)}
              aria-describedby={state.fieldErrors?.displayName ? 'displayName-error' : undefined}
            />
            <FieldError name="displayName" state={state} />
          </div>
        )}
        <div className="form-field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={state.values?.email}
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          />
          <FieldError name="email" state={state} />
        </div>
        <PasswordField name="password" label="Password" signup={signup} state={state} />
        {signup && (
          <PasswordField name="confirmPassword" label="Confirm password" signup state={state} />
        )}
        <SubmitButton pendingText={signup ? 'Creating account...' : 'Signing in...'}>
          {signup ? 'Create account' : 'Sign in'}
          <ArrowRight size={18} aria-hidden="true" />
        </SubmitButton>
      </form>
    </>
  );
}
