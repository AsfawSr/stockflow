'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { BookPlus, Trash2, X } from 'lucide-react';
import { removeCatalogPriceAction, setCatalogPriceAction } from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

type Option = { id: string; label: string };

function QuoteForm({
  organizationId,
  supplierId,
  products,
  onDone,
}: {
  organizationId: string;
  supplierId: string;
  products: Option[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(setCatalogPriceAction, {} as FormState);
  const [productId, setProductId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="supplierId" value={supplierId} />
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor="quote-product">Product</label>
        <select
          id="quote-product"
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
        <label htmlFor="quote-price">Quoted unit price</label>
        <input
          id="quote-price"
          name="unitPrice"
          inputMode="decimal"
          required
          maxLength={13}
          placeholder="25.50"
          value={unitPrice}
          onChange={(event) => setUnitPrice(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.unitPrice)}
        />
        <FieldError name="unitPrice" state={state} />
      </div>
      <p className="muted">Quoting a product that already has a quote replaces it.</p>
      <div className="dialog-actions">
        <SubmitButton pendingText="Saving...">
          <BookPlus size={16} aria-hidden="true" />
          Save quote
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddQuoteButton({
  organizationId,
  supplierId,
  products,
}: {
  organizationId: string;
  supplierId: string;
  products: Option[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const close = () => {
    dialog.current?.close();
    setFormKey((key) => key + 1);
  };
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <BookPlus size={17} aria-hidden="true" />
        Record quote
      </button>
      <dialog className="organization-dialog" ref={dialog} aria-label="Record quote">
        <div className="dialog-heading">
          <h2>Record quote</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <QuoteForm
          key={formKey}
          organizationId={organizationId}
          supplierId={supplierId}
          products={products}
          onDone={close}
        />
      </dialog>
    </>
  );
}

export function RemoveQuoteButton({
  organizationId,
  supplierId,
  productId,
  label,
}: {
  organizationId: string;
  supplierId: string;
  productId: string;
  label: string;
}) {
  const [state, action] = useActionState(removeCatalogPriceAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="productId" value={productId} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <Trash2 size={15} aria-hidden="true" />
        <span className="visually-hidden">Remove quote for {label}</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
