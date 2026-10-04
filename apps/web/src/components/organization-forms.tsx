'use client';

import { useActionState, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Building2,
  Plus,
  Save,
  Search,
  X,
} from 'lucide-react';
import {
  archiveOrganizationAction,
  createOrganizationAction,
  renameOrganizationAction,
  restoreOrganizationAction,
  selectOrganizationAction,
} from '@/app/actions';
import { roleLabels, type FormState, type Organization } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

export function CreateOrganizationButton({
  currencies,
}: {
  currencies: { code: string; label: string }[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(createOrganizationAction, {} as FormState);
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <Plus size={17} aria-hidden="true" />
        New organization
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-labelledby="create-organization-title"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2 id="create-organization-title">New organization</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            disabled={pending}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <form action={action} className="stacked-form">
          <FormFeedback state={state} />
          <div className="form-field">
            <label htmlFor="organization-name">Organization name</label>
            <input
              id="organization-name"
              name="name"
              required
              maxLength={160}
              defaultValue={state.values?.name}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
            />
            <FieldError name="name" state={state} />
          </div>
          <div className="form-field">
            <label htmlFor="currency">Currency</label>
            <select id="currency" name="currency" defaultValue={state.values?.currency ?? 'USD'}>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.label}
                </option>
              ))}
            </select>
            <FieldError name="currency" state={state} />
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <SubmitButton pendingText="Creating...">
              <Plus size={17} aria-hidden="true" />
              Create organization
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function OrganizationPicker({ organizations }: { organizations: Organization[] }) {
  const [query, setQuery] = useState('');
  const [state, action, pending] = useActionState(selectOrganizationAction, {} as FormState);
  const visible = organizations.filter((organization) =>
    organization.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      {organizations.length > 0 && (
        <div className="selection-toolbar">
          <div className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Search organizations"
              type="search"
              placeholder="Search organizations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <span>
            {organizations.length} {organizations.length === 1 ? 'organization' : 'organizations'}
          </span>
        </div>
      )}
      <form action={action} aria-busy={pending}>
        <FormFeedback state={state} />
        {pending && (
          <p className="selection-progress" role="status">
            Opening organization...
          </p>
        )}
        <div className="organization-list">
          {visible.map((organization) => (
            <button
              type="submit"
              name="organizationId"
              value={organization.id}
              key={organization.id}
              className="organization-option"
              disabled={pending}
              aria-label={`Open ${organization.name}`}
            >
              <span className="organization-mark">
                <Building2 size={22} aria-hidden="true" />
              </span>
              <span className="organization-option-content">
                <strong>{organization.name}</strong>
                <span className="role-list">
                  {organization.roles.map((role) => (
                    <span className="role-tag" key={role}>
                      {roleLabels[role]}
                    </span>
                  ))}
                  <span className="organization-currency">{organization.currency}</span>
                </span>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      </form>
      {visible.length === 0 && (
        <div className="empty-organizations">
          <Building2 size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>{organizations.length ? 'No matching organizations' : 'No organizations yet'}</h2>
        </div>
      )}
    </>
  );
}

export function RenameOrganizationForm({ organization }: { organization: Organization }) {
  const [state, action] = useActionState(renameOrganizationAction, {} as FormState);
  return (
    <form action={action} className="stacked-form rename-form">
      <input type="hidden" name="organizationId" value={organization.id} />
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor="name">Organization name</label>
        <input
          key={organization.updatedAt}
          id="name"
          name="name"
          required
          maxLength={160}
          defaultValue={organization.name}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
        />
        <FieldError name="name" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor="reply-to-email">Order reply-to email (optional)</label>
        <input
          key={`reply-${organization.updatedAt}`}
          id="reply-to-email"
          name="replyToEmail"
          type="email"
          maxLength={254}
          defaultValue={organization.replyToEmail ?? ''}
          aria-invalid={Boolean(state.fieldErrors?.replyToEmail)}
        />
        <p className="field-hint">
          Supplier replies to order emails and daily low-stock digests go to this address.
        </p>
        <FieldError name="replyToEmail" state={state} />
      </div>
      <SubmitButton pendingText="Saving...">
        <Save size={16} aria-hidden="true" />
        Save profile
      </SubmitButton>
    </form>
  );
}

export function ArchiveOrganizationControls({ organization }: { organization: Organization }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveOrganizationAction,
    {} as FormState,
  );
  const [restoreState, restoreAction] = useActionState(restoreOrganizationAction, {} as FormState);
  if (organization.archivedAt) {
    return (
      <form action={restoreAction} className="row-action-form">
        <input type="hidden" name="organizationId" value={organization.id} />
        <FormFeedback state={restoreState} />
        <SubmitButton pendingText="Restoring...">
          <ArchiveRestore size={16} aria-hidden="true" />
          Restore organization
        </SubmitButton>
      </form>
    );
  }
  return (
    <>
      <button className="secondary-button" onClick={() => dialog.current?.showModal()}>
        <Archive size={16} aria-hidden="true" />
        Archive organization
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-label={`Archive ${organization.name}`}
        onCancel={(event) => {
          if (archivePending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2>Archive {organization.name}?</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            disabled={archivePending}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">
          Members keep read access to every screen and export, but all changes are blocked until an
          administrator restores the organization. No data is deleted.
        </p>
        <form action={archiveAction} className="stacked-form">
          <input type="hidden" name="organizationId" value={organization.id} />
          <FormFeedback state={archiveState} />
          <div className="dialog-actions">
            <SubmitButton pendingText="Archiving...">
              <Archive size={16} aria-hidden="true" />
              Archive organization
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
