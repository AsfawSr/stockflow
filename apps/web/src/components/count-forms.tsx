'use client';

import { useActionState, useRef, useState } from 'react';
import { CheckCheck, ClipboardList, Plus, Trash2, X, XCircle } from 'lucide-react';
import {
  cancelCycleCountAction,
  completeCycleCountAction,
  openCycleCountAction,
  recordCountLineAction,
  removeCountLineAction,
} from '@/app/actions';
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

export function RecordCountForm({
  organizationId,
  countId,
  products,
}: {
  organizationId: string;
  countId: string;
  products: Option[];
}) {
  const [state, action] = useActionState(recordCountLineAction, {} as FormState);
  // Controlled fields survive the automatic form reset after a rejected submission.
  const [productId, setProductId] = useState('');
  const [countedQuantity, setCountedQuantity] = useState('');
  return (
    <form action={action} className="stacked-form add-line-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="countId" value={countId} />
      <FormFeedback state={state} />
      <div className="add-line-grid">
        <div className="form-field">
          <label htmlFor="count-product">Product</label>
          <select
            id="count-product"
            name="productId"
            required
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="" disabled>
              Choose a product
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.label}
              </option>
            ))}
          </select>
          <FieldError name="productId" state={state} />
        </div>
        <div className="form-field">
          <label htmlFor="count-quantity">Counted quantity</label>
          <input
            id="count-quantity"
            name="countedQuantity"
            type="number"
            min={0}
            max={1000000}
            step={1}
            required
            value={countedQuantity}
            onChange={(event) => setCountedQuantity(event.target.value)}
          />
          <FieldError name="countedQuantity" state={state} />
        </div>
        <SubmitButton className="secondary-button add-line-submit" pendingText="Saving...">
          <Plus size={16} aria-hidden="true" />
          Save count
        </SubmitButton>
      </div>
    </form>
  );
}

export function RemoveCountLineButton({
  organizationId,
  countId,
  productId,
  label,
}: {
  organizationId: string;
  countId: string;
  productId: string;
  label: string;
}) {
  const [state, action] = useActionState(removeCountLineAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="countId" value={countId} />
      <input type="hidden" name="productId" value={productId} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <Trash2 size={15} aria-hidden="true" />
        <span className="visually-hidden">Remove {label} from the count</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function CompleteCountButton({
  organizationId,
  countId,
}: {
  organizationId: string;
  countId: string;
}) {
  const [state, action] = useActionState(completeCycleCountAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="countId" value={countId} />
      <FormFeedback state={state} />
      <SubmitButton pendingText="Completing...">
        <CheckCheck size={16} aria-hidden="true" />
        Complete count
      </SubmitButton>
    </form>
  );
}

export function CancelCountButton({
  organizationId,
  countId,
}: {
  organizationId: string;
  countId: string;
}) {
  const [state, action] = useActionState(cancelCycleCountAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="countId" value={countId} />
      <FormFeedback state={state} />
      <SubmitButton className="secondary-button" pendingText="Cancelling...">
        <XCircle size={16} aria-hidden="true" />
        Cancel count
      </SubmitButton>
    </form>
  );
}
