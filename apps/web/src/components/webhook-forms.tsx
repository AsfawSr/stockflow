'use client';

import { useActionState, useRef, useState } from 'react';
import { Plus, Power, Trash2, X } from 'lucide-react';
import { createWebhookAction, deleteWebhookAction, updateWebhookAction } from '@/app/actions';
import type { FormState, Webhook } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

function AddWebhookForm({
  organizationId,
  onDone,
}: {
  organizationId: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState(createWebhookAction, {} as FormState);
  if (state.success && state.values?.secret) {
    return (
      <div className="stacked-form">
        <FormFeedback state={{ success: state.success }} />
        <p className="muted">
          Use this secret to verify the X-StockFlow-Signature header on every delivery. It is never
          shown again after you close this dialog.
        </p>
        <p className="webhook-secret">
          <code data-testid="webhook-secret">{state.values.secret}</code>
        </p>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor="webhook-url">Delivery URL</label>
        <input
          id="webhook-url"
          name="url"
          type="url"
          required
          maxLength={2048}
          placeholder="https://example.com/hooks/stockflow"
          defaultValue={state.values?.url ?? ''}
          aria-invalid={Boolean(state.fieldErrors?.url)}
          aria-describedby={state.fieldErrors?.url ? 'url-error' : undefined}
        />
        <FieldError name="url" state={state} />
      </div>
      <p className="muted">
        StockFlow posts purchase order events to this URL and signs each request with a secret shown
        once after you save.
      </p>
      <div className="dialog-actions">
        <SubmitButton pendingText="Saving...">
          <Plus size={16} aria-hidden="true" />
          Add webhook
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddWebhookButton({ organizationId }: { organizationId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const close = () => {
    dialog.current?.close();
    setFormKey((key) => key + 1);
  };
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <Plus size={17} aria-hidden="true" />
        Add webhook
      </button>
      <dialog className="organization-dialog" ref={dialog} aria-label="Add webhook">
        <div className="dialog-heading">
          <h2>Add webhook</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <AddWebhookForm key={formKey} organizationId={organizationId} onDone={close} />
      </dialog>
    </>
  );
}

export function WebhookToggleButton({
  organizationId,
  webhook,
}: {
  organizationId: string;
  webhook: Webhook;
}) {
  const [state, action] = useActionState(updateWebhookAction, {} as FormState);
  const label = `${webhook.active ? 'Disable' : 'Enable'} ${webhook.url}`;
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="webhookId" value={webhook.id} />
      <input type="hidden" name="active" value={String(!webhook.active)} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <Power size={15} aria-hidden="true" />
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

export function DeleteWebhookButton({
  organizationId,
  webhook,
}: {
  organizationId: string;
  webhook: Webhook;
}) {
  const [state, action] = useActionState(deleteWebhookAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="webhookId" value={webhook.id} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <Trash2 size={15} aria-hidden="true" />
        <span className="visually-hidden">{`Delete ${webhook.url}`}</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
