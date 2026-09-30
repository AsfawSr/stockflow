'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { MailPlus, Trash2, UserRoundCheck, X } from 'lucide-react';
import { acceptInvitationAction, inviteMemberAction, revokeInvitationAction } from '@/app/actions';
import { roleLabels, type FormState, type Role } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

function InviteFields({ organizationId, onDone }: { organizationId: string; onDone: () => void }) {
  const [state, action] = useActionState(inviteMemberAction, {} as FormState);
  // Controlled fields survive the automatic form reset after a rejected submission.
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  const toggleRole = (role: Role, checked: boolean) =>
    setRoles((current) => (checked ? [...current, role] : current.filter((item) => item !== role)));
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor="invite-email">Email address</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
        />
        <FieldError name="email" state={state} />
      </div>
      <fieldset className="form-field role-fieldset">
        <legend>Roles</legend>
        {(Object.entries(roleLabels) as [Role, string][]).map(([role, label]) => (
          <label key={role} className="checkbox-label">
            <input
              type="checkbox"
              name="roles"
              value={role}
              checked={roles.includes(role)}
              onChange={(event) => toggleRole(role, event.target.checked)}
            />
            {label}
          </label>
        ))}
        <FieldError name="roles" state={state} />
      </fieldset>
      <div className="dialog-actions">
        <SubmitButton pendingText="Inviting...">
          <MailPlus size={16} aria-hidden="true" />
          Send invitation
        </SubmitButton>
      </div>
    </form>
  );
}

export function InviteMemberButton({ organizationId }: { organizationId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const close = () => {
    dialog.current?.close();
    setFormKey((key) => key + 1);
  };
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <MailPlus size={16} aria-hidden="true" />
        Invite member
      </button>
      <dialog className="organization-dialog" ref={dialog} aria-label="Invite member">
        <div className="dialog-heading">
          <h2>Invite member</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <InviteFields key={formKey} organizationId={organizationId} onDone={close} />
      </dialog>
    </>
  );
}

export function RevokeInvitationButton({
  organizationId,
  invitationId,
  email,
}: {
  organizationId: string;
  invitationId: string;
  email: string;
}) {
  const [state, action] = useActionState(revokeInvitationAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <Trash2 size={15} aria-hidden="true" />
        <span className="visually-hidden">Revoke invitation for {email}</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function AcceptInvitationForm() {
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
    return acceptInvitationAction(previous, form);
  }, {} as FormState);
  return (
    <>
      <div className="recovery-symbol">
        <UserRoundCheck size={25} aria-hidden="true" />
      </div>
      <p className="eyebrow">ORGANIZATION INVITATION</p>
      <h1>Join the organization</h1>
      <p className="muted">
        Accept the invitation sent to your email address to join the workspace.
      </p>
      <form action={action} className="stacked-form recovery-form">
        <FormFeedback state={state} />
        <SubmitButton pendingText="Joining...">
          <UserRoundCheck size={17} aria-hidden="true" />
          Accept invitation
        </SubmitButton>
      </form>
    </>
  );
}
