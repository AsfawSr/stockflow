'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { ShieldCheck, UserRoundX, X } from 'lucide-react';
import { removeMemberAction, updateMemberRolesAction } from '@/app/actions';
import { roleLabels, type FormState, type Role } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

function RoleFields({
  organizationId,
  memberUserId,
  initialRoles,
  onDone,
}: {
  organizationId: string;
  memberUserId: string;
  initialRoles: Role[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(updateMemberRolesAction, {} as FormState);
  // Controlled fields survive the automatic form reset after a rejected submission.
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  const toggleRole = (role: Role, checked: boolean) =>
    setRoles((current) => (checked ? [...current, role] : current.filter((item) => item !== role)));
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="memberUserId" value={memberUserId} />
      <FormFeedback state={state} />
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
        <SubmitButton pendingText="Saving...">
          <ShieldCheck size={16} aria-hidden="true" />
          Save roles
        </SubmitButton>
      </div>
    </form>
  );
}

export function MemberRolesButton({
  organizationId,
  memberUserId,
  email,
  roles,
}: {
  organizationId: string;
  memberUserId: string;
  email: string;
  roles: Role[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const title = `Edit roles for ${email}`;
  const close = () => {
    dialog.current?.close();
    setFormKey((key) => key + 1);
  };
  return (
    <>
      <button
        className="secondary-button row-button"
        onClick={() => dialog.current?.showModal()}
        aria-label={title}
        title={title}
      >
        <ShieldCheck size={15} aria-hidden="true" />
      </button>
      <dialog className="organization-dialog" ref={dialog} aria-label={title}>
        <div className="dialog-heading">
          <h2>Edit roles</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="muted dialog-subject">{email}</p>
        <RoleFields
          key={formKey}
          organizationId={organizationId}
          memberUserId={memberUserId}
          initialRoles={roles}
          onDone={close}
        />
      </dialog>
    </>
  );
}

export function RemoveMemberButton({
  organizationId,
  memberUserId,
  email,
}: {
  organizationId: string;
  memberUserId: string;
  email: string;
}) {
  const [state, action] = useActionState(removeMemberAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="memberUserId" value={memberUserId} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <UserRoundX size={15} aria-hidden="true" />
        <span className="visually-hidden">Remove {email}</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
