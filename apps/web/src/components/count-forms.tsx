'use client';

import { useActionState, useRef } from 'react';
import { ClipboardList, X } from 'lucide-react';
import { openCycleCountAction } from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

type Option = { id: string; label: string };

export function OpenCountButton({
  organizationId,
  locations,
}: {
  organizationId: string;
  locations: Option[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(openCycleCountAction, {} as FormState);
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <ClipboardList size={17} aria-hidden="true" />
        New count
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-label="New cycle count"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2>New cycle count</h2>
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
          <input type="hidden" name="organizationId" value={organizationId} />
          <FormFeedback state={state} />
          <div className="form-field">
            <label htmlFor="count-location">Location</label>
            <select
              id="count-location"
              name="locationId"
              required
              defaultValue={state.values?.locationId ?? ''}
            >
              <option value="" disabled>
                Choose a location
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </select>
            <FieldError name="locationId" state={state} />
          </div>
          <div className="form-field">
            <label htmlFor="count-note">Note (optional)</label>
            <input
              id="count-note"
              name="note"
              maxLength={500}
              placeholder="Friday sweep, aisle 3"
              defaultValue={state.values?.note ?? ''}
            />
            <FieldError name="note" state={state} />
          </div>
          <p className="muted">
            Count the real shelf quantities at this location. Completing the session posts any
            differences as stock adjustments.
          </p>
          <div className="dialog-actions">
            <SubmitButton pendingText="Opening...">
              <ClipboardList size={16} aria-hidden="true" />
              Open count
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
