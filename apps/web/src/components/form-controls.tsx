'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import type { FormState } from '@/lib/contracts';

export function FormFeedback({ state }: { state: FormState }) {
  const error = state.error ?? (state.fieldErrors ? 'Check the highlighted fields.' : undefined);
  if (error)
    return (
      <p className="form-alert" role="alert">
        {error}
      </p>
    );
  if (state.success)
    return (
      <p className="form-success" role="status">
        {state.success}
      </p>
    );
  return null;
}

export function FieldError({ name, state }: { name: string; state: FormState }) {
  return state.fieldErrors?.[name] ? (
    <p id={`${name}-error`} className="field-error">
      {state.fieldErrors[name]?.[0]}
    </p>
  ) : null;
}

export function PasswordField({
  name,
  label,
  signup,
  state,
}: {
  name: string;
  label: string;
  signup: boolean;
  state: FormState;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <div className="password-field">
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          required
          minLength={signup ? 12 : 1}
          maxLength={128}
          autoComplete={signup ? 'new-password' : 'current-password'}
          aria-invalid={Boolean(state.fieldErrors?.[name])}
          aria-describedby={state.fieldErrors?.[name] ? `${name}-error` : undefined}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          title={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      <FieldError name={name} state={state} />
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
  className = 'primary-button',
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <LoaderCircle size={17} className="spinning" aria-hidden="true" />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
