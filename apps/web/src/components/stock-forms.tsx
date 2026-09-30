'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, SlidersHorizontal, X } from 'lucide-react';
import { createAdjustmentAction, createTransferAction } from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

type Option = { id: string; label: string };
type FieldChange = React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

function TransferFields({
  organizationId,
  products,
  locations,
  onDone,
}: {
  organizationId: string;
  products: Option[];
  locations: Option[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(createTransferAction, {} as FormState);
  // Controlled fields survive the automatic form reset after a rejected submission.
  const [values, setValues] = useState({
    productId: '',
    fromLocationId: '',
    toLocationId: '',
    quantity: '',
    note: '',
  });
  const edit = (event: FieldChange) =>
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor="transfer-product">Product</label>
        <select
          id="transfer-product"
          name="productId"
          value={values.productId}
          onChange={edit}
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
        <label htmlFor="transfer-from">From location</label>
        <select
          id="transfer-from"
          name="fromLocationId"
          value={values.fromLocationId}
          onChange={edit}
        >
          <option value="" disabled>
            Choose a source
          </option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </select>
        <FieldError name="fromLocationId" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor="transfer-to">To location</label>
        <select id="transfer-to" name="toLocationId" value={values.toLocationId} onChange={edit}>
          <option value="" disabled>
            Choose a destination
          </option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </select>
        <FieldError name="toLocationId" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor="transfer-quantity">Quantity</label>
        <input
          id="transfer-quantity"
          name="quantity"
          type="number"
          min={1}
          max={1000000}
          step={1}
          value={values.quantity}
          onChange={edit}
        />
        <FieldError name="quantity" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor="transfer-note">Note (optional)</label>
        <textarea
          id="transfer-note"
          name="note"
          rows={2}
          maxLength={500}
          value={values.note}
          onChange={edit}
        />
        <FieldError name="note" state={state} />
      </div>
      <div className="dialog-actions">
        <SubmitButton pendingText="Recording...">
          <ArrowLeftRight size={16} aria-hidden="true" />
          Record transfer
        </SubmitButton>
      </div>
    </form>
  );
}

export function TransferButton({
  organizationId,
  products,
  locations,
}: {
  organizationId: string;
  products: Option[];
  locations: Option[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const blocked = products.length === 0 || locations.length < 2;
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <ArrowLeftRight size={16} aria-hidden="true" />
        Transfer stock
      </button>
      <dialog className="organization-dialog" ref={dialog} aria-label="Transfer stock">
        <div className="dialog-heading">
          <h2>Transfer stock</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={() => {
              dialog.current?.close();
              setFormKey((key) => key + 1);
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {blocked ? (
          <p className="form-notice" role="status">
            Transfers need an active product and two active locations.
          </p>
        ) : (
          <TransferFields
            key={formKey}
            organizationId={organizationId}
            products={products}
            locations={locations}
            onDone={() => {
              dialog.current?.close();
              setFormKey((key) => key + 1);
            }}
          />
        )}
      </dialog>
    </>
  );
}

function AdjustmentFields({
  organizationId,
  products,
  locations,
  onDone,
}: {
  organizationId: string;
  products: Option[];
  locations: Option[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(createAdjustmentAction, {} as FormState);
  const [values, setValues] = useState({ productId: '', locationId: '', quantity: '', reason: '' });
  const edit = (event: FieldChange) =>
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor="adjust-product">Product</label>
        <select id="adjust-product" name="productId" value={values.productId} onChange={edit}>
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
        <label htmlFor="adjust-location">Location</label>
        <select id="adjust-location" name="locationId" value={values.locationId} onChange={edit}>
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
        <label htmlFor="adjust-quantity">Quantity change</label>
        <input
          id="adjust-quantity"
          name="quantity"
          type="number"
          min={-1000000}
          max={1000000}
          step={1}
          value={values.quantity}
          onChange={edit}
          aria-describedby="adjust-quantity-hint"
        />
        <p id="adjust-quantity-hint" className="field-hint">
          Use a negative number to remove stock, such as -2.
        </p>
        <FieldError name="quantity" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor="adjust-reason">Reason</label>
        <textarea
          id="adjust-reason"
          name="reason"
          rows={2}
          maxLength={500}
          value={values.reason}
          onChange={edit}
        />
        <FieldError name="reason" state={state} />
      </div>
      <div className="dialog-actions">
        <SubmitButton pendingText="Recording...">
          <SlidersHorizontal size={16} aria-hidden="true" />
          Record adjustment
        </SubmitButton>
      </div>
    </form>
  );
}

export function AdjustmentButton({
  organizationId,
  products,
  locations,
}: {
  organizationId: string;
  products: Option[];
  locations: Option[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const blocked = products.length === 0 || locations.length === 0;
  return (
    <>
      <button className="secondary-button" onClick={() => dialog.current?.showModal()}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        Adjust stock
      </button>
      <dialog className="organization-dialog" ref={dialog} aria-label="Adjust stock">
        <div className="dialog-heading">
          <h2>Adjust stock</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={() => {
              dialog.current?.close();
              setFormKey((key) => key + 1);
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {blocked ? (
          <p className="form-notice" role="status">
            Adjustments need an active product and location.
          </p>
        ) : (
          <AdjustmentFields
            key={formKey}
            organizationId={organizationId}
            products={products}
            locations={locations}
            onDone={() => {
              dialog.current?.close();
              setFormKey((key) => key + 1);
            }}
          />
        )}
      </dialog>
    </>
  );
}
