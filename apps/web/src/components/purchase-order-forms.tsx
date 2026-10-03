'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  Check,
  ClipboardList,
  PackageCheck,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  addOrderLineAction,
  createPurchaseOrderAction,
  orderFromSuggestionAction,
  receiveOrderAction,
  rejectOrderAction,
  removeOrderLineAction,
  transitionOrderAction,
} from '@/app/actions';
import type { FormState, PurchaseOrder, SupplierPrice } from '@/lib/contracts';
import { FieldError, FormFeedback, SubmitButton } from './form-controls';

type Option = { id: string; label: string };

export function CreateOrderButton({
  organizationId,
  suppliers,
  locations,
}: {
  organizationId: string;
  suppliers: Option[];
  locations: Option[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(createPurchaseOrderAction, {} as FormState);
  const blocked = suppliers.length === 0 || locations.length === 0;
  return (
    <>
      <button className="primary-button" onClick={() => dialog.current?.showModal()}>
        <Plus size={17} aria-hidden="true" />
        New order
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-label="New purchase order"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2>New purchase order</h2>
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
        {blocked ? (
          <p className="form-notice" role="status">
            Create an active supplier and location before ordering.
          </p>
        ) : (
          <form action={action} className="stacked-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <FormFeedback state={state} />
            <div className="form-field">
              <label htmlFor="order-supplier">Supplier</label>
              <select
                id="order-supplier"
                name="supplierId"
                defaultValue={state.values?.supplierId ?? ''}
              >
                <option value="" disabled>
                  Choose a supplier
                </option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.label}
                  </option>
                ))}
              </select>
              <FieldError name="supplierId" state={state} />
            </div>
            <div className="form-field">
              <label htmlFor="order-location">Deliver to</label>
              <select
                id="order-location"
                name="locationId"
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
              <label htmlFor="order-note">Note (optional)</label>
              <textarea
                id="order-note"
                name="note"
                rows={2}
                maxLength={1000}
                defaultValue={state.values?.note}
              />
              <FieldError name="note" state={state} />
            </div>
            <div className="dialog-actions">
              <SubmitButton pendingText="Creating...">
                <ClipboardList size={17} aria-hidden="true" />
                Create draft
              </SubmitButton>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

export function SuggestionOrderButton({
  organizationId,
  locations,
  suggestion,
}: {
  organizationId: string;
  locations: Option[];
  suggestion: {
    productId: string;
    productName: string;
    sku: string;
    supplierId: string;
    supplierName: string;
    quantity: number;
    unitPrice: string;
  };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(orderFromSuggestionAction, {} as FormState);
  const field = (name: string) => `suggestion-${suggestion.productId}-${name}`;
  return (
    <>
      <button
        className="secondary-button"
        aria-label={`Order ${suggestion.sku}`}
        onClick={() => dialog.current?.showModal()}
      >
        <ClipboardList size={16} aria-hidden="true" />
        Order
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-label={`Order ${suggestion.productName}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2>Order {suggestion.productName}</h2>
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
        <p className="muted">Creates a draft order with {suggestion.supplierName}.</p>
        {locations.length === 0 ? (
          <p className="form-notice" role="status">
            Create an active location before ordering.
          </p>
        ) : (
          <form action={action} className="stacked-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="supplierId" value={suggestion.supplierId} />
            <input type="hidden" name="productId" value={suggestion.productId} />
            <FormFeedback state={state} />
            <div className="form-field">
              <label htmlFor={field('location')}>Deliver to</label>
              <select
                id={field('location')}
                name="locationId"
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
              <label htmlFor={field('quantity')}>Quantity</label>
              <input
                id={field('quantity')}
                name="quantity"
                type="number"
                min={1}
                max={1000000}
                required
                defaultValue={state.values?.quantity ?? String(suggestion.quantity)}
              />
              <FieldError name="quantity" state={state} />
            </div>
            <div className="form-field">
              <label htmlFor={field('price')}>Unit price</label>
              <input
                id={field('price')}
                name="unitPrice"
                inputMode="decimal"
                required
                defaultValue={state.values?.unitPrice ?? suggestion.unitPrice}
              />
              <FieldError name="unitPrice" state={state} />
            </div>
            <div className="dialog-actions">
              <SubmitButton pendingText="Creating...">
                <ClipboardList size={17} aria-hidden="true" />
                Create draft
              </SubmitButton>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

export function AddLineForm({
  organizationId,
  orderId,
  products,
  prices = {},
}: {
  organizationId: string;
  orderId: string;
  products: Option[];
  prices?: Record<string, SupplierPrice>;
}) {
  const [formKey, setFormKey] = useState(0);
  return (
    <AddLineFields
      key={formKey}
      organizationId={organizationId}
      orderId={orderId}
      products={products}
      prices={prices}
      onDone={() => setFormKey((key) => key + 1)}
    />
  );
}

function AddLineFields({
  organizationId,
  orderId,
  products,
  prices,
  onDone,
}: {
  organizationId: string;
  orderId: string;
  products: Option[];
  prices: Record<string, SupplierPrice>;
  onDone: () => void;
}) {
  const [state, action] = useActionState(addOrderLineAction, {} as FormState);
  // Controlled fields survive the automatic form reset after a rejected submission.
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  const lastPrice = productId ? prices[productId] : undefined;
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(date),
    );
  return (
    <form action={action} className="stacked-form add-line-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="orderId" value={orderId} />
      <FormFeedback state={state} />
      <div className="add-line-grid">
        <div className="form-field">
          <label htmlFor="line-product">Product</label>
          <select
            id="line-product"
            name="productId"
            value={productId}
            onChange={(event) => {
              const next = event.target.value;
              setProductId(next);
              const known = prices[next];
              if (known) setUnitPrice(known.unitPrice);
            }}
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
          <label htmlFor="line-quantity">Quantity</label>
          <input
            id="line-quantity"
            name="quantity"
            type="number"
            min={1}
            max={1000000}
            step={1}
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <FieldError name="quantity" state={state} />
        </div>
        <div className="form-field">
          <label htmlFor="line-price">Unit price</label>
          <input
            id="line-price"
            name="unitPrice"
            inputMode="decimal"
            required
            maxLength={13}
            placeholder="25.50"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            aria-describedby={lastPrice ? 'line-price-hint' : undefined}
          />
          {lastPrice && (
            <p id="line-price-hint" className="field-hint">
              Last confirmed: {lastPrice.unitPrice} ({lastPrice.reference},{' '}
              {formatDate(lastPrice.decidedAt)})
            </p>
          )}
          <FieldError name="unitPrice" state={state} />
        </div>
        <SubmitButton className="secondary-button add-line-submit" pendingText="Adding...">
          <Plus size={16} aria-hidden="true" />
          Add line
        </SubmitButton>
      </div>
    </form>
  );
}

export function RemoveLineButton({
  organizationId,
  orderId,
  lineId,
  label,
}: {
  organizationId: string;
  orderId: string;
  lineId: string;
  label: string;
}) {
  const [state, action] = useActionState(removeOrderLineAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="lineId" value={lineId} />
      <SubmitButton className="secondary-button row-button" pendingText="...">
        <Trash2 size={15} aria-hidden="true" />
        <span className="visually-hidden">Remove {label}</span>
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function OrderTransitionButton({
  organizationId,
  orderId,
  transition,
  label,
  pendingLabel,
  primary,
}: {
  organizationId: string;
  orderId: string;
  transition: 'submit' | 'approve' | 'cancel' | 'revise';
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  const [state, action] = useActionState(transitionOrderAction, {} as FormState);
  const icons = { submit: Send, approve: Check, cancel: XCircle, revise: RotateCcw } as const;
  const Icon = icons[transition];
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="transition" value={transition} />
      <SubmitButton
        className={primary ? 'primary-button' : 'secondary-button'}
        pendingText={pendingLabel}
      >
        <Icon size={16} aria-hidden="true" />
        {label}
      </SubmitButton>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RejectOrderButton({
  organizationId,
  orderId,
}: {
  organizationId: string;
  orderId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(rejectOrderAction, {} as FormState);
  return (
    <>
      <button className="secondary-button" onClick={() => dialog.current?.showModal()}>
        <XCircle size={16} aria-hidden="true" />
        Reject
      </button>
      <dialog
        className="organization-dialog"
        ref={dialog}
        aria-label="Reject order"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2>Reject order</h2>
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
          <input type="hidden" name="orderId" value={orderId} />
          <FormFeedback state={state} />
          <div className="form-field">
            <label htmlFor="reject-note">Why is this order rejected?</label>
            <textarea id="reject-note" name="note" rows={3} required maxLength={1000} />
            <FieldError name="note" state={state} />
          </div>
          <div className="dialog-actions">
            <SubmitButton pendingText="Rejecting...">
              <XCircle size={16} aria-hidden="true" />
              Reject order
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function ReceiptForm({
  organizationId,
  order,
}: {
  organizationId: string;
  order: PurchaseOrder;
}) {
  const [formKey, setFormKey] = useState(0);
  return (
    <ReceiptFields
      key={formKey}
      organizationId={organizationId}
      order={order}
      onDone={() => setFormKey((key) => key + 1)}
    />
  );
}

function ReceiptFields({
  organizationId,
  order,
  onDone,
}: {
  organizationId: string;
  order: PurchaseOrder;
  onDone: () => void;
}) {
  const [state, action] = useActionState(receiveOrderAction, {} as FormState);
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  const receivable = order.lines.filter((line) => line.remainingQuantity > 0);
  return (
    <form action={action} className="stacked-form receipt-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="orderId" value={order.id} />
      <FormFeedback state={state} />
      {receivable.map((line) => (
        <div className="form-field receipt-line" key={line.id}>
          <label htmlFor={`quantity-${line.id}`}>
            {line.product.sku} · {line.product.name}
            <small>
              {line.remainingQuantity} of {line.quantity} {line.product.unit} remaining
            </small>
          </label>
          <input
            id={`quantity-${line.id}`}
            name={`quantity-${line.id}`}
            type="number"
            min={0}
            max={line.remainingQuantity}
            step={1}
            placeholder="0"
          />
        </div>
      ))}
      <div className="form-field">
        <label htmlFor="receipt-note">Delivery note (optional)</label>
        <input id="receipt-note" name="note" maxLength={500} />
      </div>
      <SubmitButton pendingText="Recording...">
        <PackageCheck size={17} aria-hidden="true" />
        Record delivery
      </SubmitButton>
    </form>
  );
}
