'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, X } from 'lucide-react';
import { createProductAction, setProductArchivedAction, updateProductAction } from '@/app/actions';
import type { FormState, Product } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

function ProductFields({ state, product }: { state: FormState; product?: Product }) {
  const id = useId();
  const values = state.values ?? {
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    unit: product?.unit ?? '',
    description: product?.description ?? '',
    reorderPoint: product?.reorderPoint === null ? '' : String(product?.reorderPoint ?? ''),
  };
  return (
    <>
      <FormFeedback state={state} />
      <div className="form-field">
        <label htmlFor={`${id}-sku`}>SKU</label>
        <input
          id={`${id}-sku`}
          name="sku"
          required
          maxLength={64}
          defaultValue={values.sku}
          aria-invalid={Boolean(state.fieldErrors?.sku)}
          aria-describedby={state.fieldErrors?.sku ? 'sku-error' : `${id}-sku-hint`}
        />
        <p id={`${id}-sku-hint`} className="field-hint">
          Letters, digits, dots, underscores, and hyphens. Stored uppercase.
        </p>
        <FieldError name="sku" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-name`}>Product name</label>
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={160}
          defaultValue={values.name}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
        />
        <FieldError name="name" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-unit`}>Stock unit</label>
        <input
          id={`${id}-unit`}
          name="unit"
          required
          maxLength={32}
          placeholder="piece"
          defaultValue={values.unit}
          aria-invalid={Boolean(state.fieldErrors?.unit)}
          aria-describedby={state.fieldErrors?.unit ? 'unit-error' : undefined}
        />
        <FieldError name="unit" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-reorderPoint`}>Reorder point (optional)</label>
        <input
          id={`${id}-reorderPoint`}
          name="reorderPoint"
          type="number"
          min={0}
          max={1000000}
          step={1}
          defaultValue={values.reorderPoint}
          aria-invalid={Boolean(state.fieldErrors?.reorderPoint)}
          aria-describedby={
            state.fieldErrors?.reorderPoint ? 'reorderPoint-error' : `${id}-reorderPoint-hint`
          }
        />
        <p id={`${id}-reorderPoint-hint`} className="field-hint">
          Stock at or below this level is flagged as low.
        </p>
        <FieldError name="reorderPoint" state={state} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-description`}>Description (optional)</label>
        <textarea
          id={`${id}-description`}
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={values.description}
          aria-invalid={Boolean(state.fieldErrors?.description)}
          aria-describedby={state.fieldErrors?.description ? 'description-error' : undefined}
        />
        <FieldError name="description" state={state} />
      </div>
    </>
  );
}

function ProductDialogForm({
  organizationId,
  product,
  onDone,
  onPendingChange,
}: {
  organizationId: string;
  product?: Product;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, action, pending] = useActionState(
    product ? updateProductAction : createProductAction,
    {} as FormState,
  );
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  return (
    <form action={action} className="stacked-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      {product && <input type="hidden" name="productId" value={product.id} />}
      <ProductFields state={state} product={product} />
      <div className="dialog-actions">
        <SubmitButton pendingText={product ? 'Saving...' : 'Creating...'}>
          {product ? (
            <Pencil size={16} aria-hidden="true" />
          ) : (
            <Plus size={17} aria-hidden="true" />
          )}
          {product ? 'Save product' : 'Create product'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ProductDialogButton({
  organizationId,
  product,
}: {
  organizationId: string;
  product?: Product;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, setPending] = useState(false);
  const title = product ? `Edit ${product.sku}` : 'New product';
  const close = () => {
    dialog.current?.close();
    setFormKey((key) => key + 1);
  };
  return (
    <>
      <button
        className={product ? 'secondary-button row-button' : 'primary-button'}
        onClick={() => dialog.current?.showModal()}
        aria-label={title}
        title={title}
      >
        {product ? (
          <Pencil size={15} aria-hidden="true" />
        ) : (
          <>
            <Plus size={17} aria-hidden="true" />
            New product
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
        <ProductDialogForm
          key={formKey}
          organizationId={organizationId}
          product={product}
          onDone={close}
          onPendingChange={setPending}
        />
      </dialog>
    </>
  );
}

export function ArchiveToggleButton({
  organizationId,
  product,
}: {
  organizationId: string;
  product: Product;
}) {
  const [state, action] = useActionState(setProductArchivedAction, {} as FormState);
  const archive = product.archivedAt === null;
  const label = `${archive ? 'Archive' : 'Restore'} ${product.sku}`;
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="archive" value={String(archive)} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        {archive ? (
          <Archive size={15} aria-hidden="true" />
        ) : (
          <ArchiveRestore size={15} aria-hidden="true" />
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
