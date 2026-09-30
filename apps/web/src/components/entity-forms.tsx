'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, X } from 'lucide-react';
import type { FormState } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

type EntityAction = (previous: FormState, form: FormData) => Promise<FormState>;

export type EntityField = {
  name: string;
  label: string;
  required?: boolean;
  maxLength: number;
  textarea?: boolean;
  type?: 'text' | 'email' | 'tel';
  hint?: string;
};

function EntityForm({
  action,
  fields,
  values,
  hidden,
  editing,
  onDone,
  onPendingChange,
}: {
  action: EntityAction;
  fields: EntityField[];
  values: Record<string, string>;
  hidden: Record<string, string>;
  editing: boolean;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  const current = state.values ?? values;
  return (
    <form action={formAction} className="stacked-form">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormFeedback state={state} />
      {fields.map((field) => (
        <div className="form-field" key={field.name}>
          <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
          {field.textarea ? (
            <textarea
              id={`${id}-${field.name}`}
              name={field.name}
              rows={3}
              maxLength={field.maxLength}
              defaultValue={current[field.name]}
              aria-invalid={Boolean(state.fieldErrors?.[field.name])}
              aria-describedby={state.fieldErrors?.[field.name] ? `${field.name}-error` : undefined}
            />
          ) : (
            <input
              id={`${id}-${field.name}`}
              name={field.name}
              type={field.type ?? 'text'}
              required={field.required}
              maxLength={field.maxLength}
              defaultValue={current[field.name]}
              aria-invalid={Boolean(state.fieldErrors?.[field.name])}
              aria-describedby={
                state.fieldErrors?.[field.name]
                  ? `${field.name}-error`
                  : field.hint
                    ? `${id}-${field.name}-hint`
                    : undefined
              }
            />
          )}
          {field.hint && (
            <p id={`${id}-${field.name}-hint`} className="field-hint">
              {field.hint}
            </p>
          )}
          <FieldError name={field.name} state={state} />
        </div>
      ))}
      <div className="dialog-actions">
        <SubmitButton pendingText={editing ? 'Saving...' : 'Creating...'}>
          {editing ? (
            <Pencil size={16} aria-hidden="true" />
          ) : (
            <Plus size={17} aria-hidden="true" />
          )}
          {editing ? 'Save changes' : 'Create'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function EntityDialogButton({
  action,
  entityLabel,
  itemName,
  fields,
  values = {},
  hidden,
}: {
  action: EntityAction;
  entityLabel: string;
  itemName?: string;
  fields: EntityField[];
  values?: Record<string, string>;
  hidden: Record<string, string>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, setPending] = useState(false);
  const editing = itemName !== undefined;
  const title = editing ? `Edit ${itemName}` : `New ${entityLabel}`;
  const close = () => {
    dialog.current?.close();
    setFormKey((key) => key + 1);
  };
  return (
    <>
      <button
        className={editing ? 'secondary-button row-button' : 'primary-button'}
        onClick={() => dialog.current?.showModal()}
        aria-label={title}
        title={title}
      >
        {editing ? (
          <Pencil size={15} aria-hidden="true" />
        ) : (
          <>
            <Plus size={17} aria-hidden="true" />
            New {entityLabel}
          </>
        )}
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-label={title}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            disabled={pending}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <EntityForm
          key={formKey}
          action={action}
          fields={fields}
          values={values}
          hidden={hidden}
          editing={editing}
          onDone={close}
          onPendingChange={setPending}
        />
      </dialog>
    </>
  );
}

export function EntityArchiveButton({
  action,
  hidden,
  archived,
  itemName,
}: {
  action: EntityAction;
  hidden: Record<string, string>;
  archived: boolean;
  itemName: string;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const label = `${archived ? 'Restore' : 'Archive'} ${itemName}`;
  return (
    <form action={formAction} className="row-action-form">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="archive" value={String(!archived)} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        {archived ? (
          <ArchiveRestore size={15} aria-hidden="true" />
        ) : (
          <Archive size={15} aria-hidden="true" />
        )}
        <span className="visually-hidden">{label}</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
