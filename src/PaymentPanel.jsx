import { useState } from 'react';
import { apiFetch, formatDateTime, formatMoney } from './api.js';
import { Feedback, Loading, Modal, StatusBadge, useActions, useLoad } from './ui.jsx';
import { DisputeButton } from './Disputes.jsx';
import Icon from './Icon.jsx';

export const METHOD_LABEL = { cash: 'Cash on delivery', nagad: 'Nagad' };
const METHOD_ICON = { cash: <Icon name="cash" />, nagad: <Icon name="mobile" /> };

const ESCROW_TEXT = {
  held: 'Held safely by MicroServiceHub. It is released to the provider when you mark the job complete.',
  disputed: 'On hold while an admin reviews the dispute.',
  released: 'Released to the provider.',
  refunded: 'Refunded to the seeker.',
};

/** Pay for (or confirm payment of) one work or booking. Props: { workId } or { bookingId }. */
export function PaymentPanel({ workId, bookingId, onChange }) {
  const query = workId ? `work_id=${workId}` : `booking_id=${bookingId}`;

  const { data, loading, error, reload } = useLoad(() => apiFetch(`/payments/for?${query}`), [query]);
  const actions = useActions(async () => {
    await reload(true);
    if (onChange) onChange();
  });

  const [method, setMethod] = useState('');
  const [trx, setTrx] = useState('');
  const [sender, setSender] = useState('');

  if (loading && !data) return <Loading />;
  if (!data) return <Feedback error={error} />;

  const { role, amount, payable, payments, methods, provider_name: providerName } = data;
  const open = payments.find((payment) => payment.status === 'pending' || payment.status === 'paid');
  const lastFailed = !open ? payments.find((payment) => payment.status === 'failed') : null;
  const choices = Object.keys(METHOD_LABEL).filter((key) => (key === 'cash' ? methods.cash : methods[key]));

  async function submit(event) {
    event.preventDefault();

    const body = { method, trx_id: trx, sender_number: sender };
    body[workId ? 'work_id' : 'booking_id'] = workId || bookingId;

    const ok = await actions.run(() => apiFetch('/payments', { method: 'POST', body }));
    if (ok) {
      setTrx('');
      setSender('');
    }
  }

  const decide = (payment, action, note) => () =>
    actions.run(
      () => apiFetch(`/payments/${payment.id}/${action}`, { method: 'PATCH', body: note ? { note } : {} }),
      action === 'confirm' ? 'Payment confirmed.' : 'Marked as not received.'
    );

  return (
    <div className="pay">
      <div className="pay-amount">
        <span>Amount due</span>
        <strong>{formatMoney(amount)}</strong>
      </div>

      <Feedback error={actions.error} notice={actions.notice} />

      {open && (
        <div className={`pay-state ${open.status}`}>
          <div className="card-row">
            <b>
              {METHOD_ICON[open.method]} {METHOD_LABEL[open.method]}
            </b>
            <StatusBadge status={open.status} />
          </div>

          {open.trx_id && (
            <p>
              TrxID <b>{open.trx_id}</b>{open.sender_number ? <> from {open.sender_number}</> : null}
            </p>
          )}
          {open.gateway && (
            <div className="pay-breakdown">
              <span>Price</span><b>{formatMoney(open.amount)}</b>
              {Number(open.fee_amount) > 0 && (<><span>Service fee</span><b>{formatMoney(open.fee_amount)}</b></>)}
              {Number(open.discount_amount) > 0 && (<><span>Promo {open.promo_code}</span><b>- {formatMoney(open.discount_amount)}</b></>)}
              <span>Charged</span><b>{formatMoney(open.charged_amount ?? open.amount)}</b>
            </div>
          )}
          {open.gateway && open.status === 'paid' && ESCROW_TEXT[open.escrow_status] && (
            <p className={`escrow escrow-${open.escrow_status}`}><Icon name="lock" /> {ESCROW_TEXT[open.escrow_status]}</p>
          )}
          <small>
            {open.status === 'paid'
              ? `Confirmed ${formatDateTime(open.paid_at)}`
              : role === 'payee'
                ? 'Confirm once the money is in your account or in your hand.'
                : `Waiting for ${providerName} to confirm.`}
          </small>

          {role === 'payee' && open.status === 'pending' && (
            <div className="card-actions">
              <button className="btn btn-sm" disabled={actions.busy} onClick={decide(open, 'confirm')}>
                <Icon name="check" /> I received it
              </button>
              <button
                className="btn btn-danger btn-sm"
                disabled={actions.busy}
                onClick={() => {
                  const note = window.prompt('What went wrong? (shown to the payer)', 'Payment not received.');
                  if (note !== null) decide(open, 'reject', note)();
                }}
              >
                Not received
              </button>
            </div>
          )}
        </div>
      )}

      {lastFailed && role === 'payer' && (
        <div className="alert">
          The last payment was marked not received{lastFailed.note ? `: ${lastFailed.note}` : '.'} You can pay again.
        </div>
      )}

      {role === 'payer' && !open && !payable && (
        <p className="quote">Payment opens once the provider is hired or the booking is accepted.</p>
      )}

      {role === 'payer' && !open && payable && (
        <form className="form" onSubmit={submit}>
          <div className="pay-methods" role="radiogroup" aria-label="Payment method">
            {choices.map((key) => (
              <button
                type="button"
                key={key}
                role="radio"
                aria-checked={method === key}
                className={`pay-method ${method === key ? 'on' : ''}`}
                onClick={() => setMethod(key)}
              >
                <span>{METHOD_ICON[key]}</span>
                <b>{METHOD_LABEL[key]}</b>
              </button>
            ))}
          </div>

          {method === 'cash' && (
            <p className="quote">Pay {providerName} in cash when the work is delivered. They confirm once they receive it.</p>
          )}

          {method === 'nagad' && (
            <>
              <p className="quote">
                Send <b>{formatMoney(amount)}</b> to <b>{providerName}</b> on {METHOD_LABEL[method]}:{' '}
                <b className="pay-number">{methods[method]}</b>. Then enter the details from the payment message.
              </p>

              <div className="form-row">
                <label className="field">
                  <span>Transaction ID (TrxID)</span>
                  <input value={trx} onChange={(event) => setTrx(event.target.value)} maxLength={40} placeholder="e.g. 9H7K2LMN4P" required />
                </label>
                <label className="field">
                  <span>Your {METHOD_LABEL[method]} number</span>
                  <input value={sender} onChange={(event) => setSender(event.target.value)} inputMode="tel" placeholder="01XXXXXXXXX" required />
                </label>
              </div>
            </>
          )}

          <button className="btn" disabled={!method || actions.busy}>
            {actions.busy ? 'Submitting...' : method === 'cash' ? 'Choose cash on delivery' : 'I have paid'}
          </button>
        </form>
      )}

      {role !== 'payer' && !open && <p className="quote">No payment has been made yet.</p>}

      {role !== 'admin' && payable && (
        <div className="pay-help">
          <DisputeButton workId={workId} bookingId={bookingId} onChange={() => { reload(true); if (onChange) onChange(); }} />
        </div>
      )}
    </div>
  );
}

/** Button that opens the payment panel in a dialog (used on cards). */
export function PaymentButton({ workId, bookingId, label = <><Icon name="card" /> Payment</>, title = 'Payment', onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="btn btn-soft btn-sm" onClick={() => setOpen(true)}>
        {label}
      </button>

      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <PaymentPanel workId={workId} bookingId={bookingId} onChange={onChange} />
        </Modal>
      )}
    </>
  );
}
