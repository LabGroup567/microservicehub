import { useState } from 'react';
import { apiFetch, formatDate, formatDateTime, formatMoney } from './api.js';
import { useAuth } from './auth.jsx';
import { METHOD_LABEL } from './PaymentPanel.jsx';
import { Empty, Feedback, Loading, StatusBadge, useActions, useLoad } from './ui.jsx';

const ESCROW_LABEL = { held: 'Held', disputed: 'Disputed', released: 'Released', refunded: 'Refunded' };

// ---------- Payments, escrow, payouts and refunds ----------

const VIEWS = [
  ['', 'All'],
  ['held', 'Held in escrow'],
  ['payouts', 'Payouts due'],
  ['refunds', 'Refunds due'],
  ['pending', 'Pending'],
  ['paid', 'Paid'],
  ['failed', 'Failed'],
];

export function AdminPayments() {
  const { user } = useAuth();
  const isMain = !!user.is_main_admin;
  const [view, setView] = useState('');

  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/admin/payments')).payments);
  const actions = useActions(reload);

  const rows = (data || []).filter((payment) => {
    if (view === 'held') return ['held', 'disputed'].includes(payment.escrow_status);
    if (view === 'payouts') return payment.payout_status === 'due';
    if (view === 'refunds') return payment.refund_status === 'due';
    if (view) return payment.status === view;
    return true;
  });

  const act = (path, body, okMessage, question) => () => {
    if (question && !window.confirm(question)) return;
    actions.run(() => apiFetch(path, { method: 'PATCH', body }), okMessage);
  };

  function payout(payment) {
    const note = window.prompt(`Pay ${formatMoney(payment.amount)} to ${payment.payee_name} on Nagad ${payment.payee_nagad || '(no number saved)'}. Then add the transaction ID here (optional):`, '');
    if (note === null) return;
    actions.run(() => apiFetch(`/admin/payments/${payment.id}/payout`, { method: 'PATCH', body: { note } }), 'Payout marked as sent.');
  }

  return (
    <>
      <div className="tabs">
        {VIEWS.map(([key, label]) => (
          <button key={key || 'all'} className={`tab ${view === key ? 'on' : ''}`} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && rows.length === 0 && <Empty title="No payments" text="Nothing matches this filter." />}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>For</th>
                <th>Payer to payee</th>
                <th>Method</th>
                <th>Amounts</th>
                <th>Status</th>
                <th>Date</th>
                {isMain && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <b>{payment.title}</b>
                    {payment.trx_id && <small>TrxID {payment.trx_id}</small>}
                    {payment.promo_code && <small>Promo {payment.promo_code}</small>}
                  </td>
                  <td>
                    {payment.payer_name}
                    <small>to {payment.payee_name}</small>
                  </td>
                  <td>{METHOD_LABEL[payment.method]}{payment.gateway ? <small>Online</small> : null}</td>
                  <td>
                    {formatMoney(payment.amount)}
                    {payment.gateway && Number(payment.fee_amount) > 0 && <small>Fee {formatMoney(payment.fee_amount)}</small>}
                    {payment.gateway && Number(payment.discount_amount) > 0 && <small>Discount {formatMoney(payment.discount_amount)}</small>}
                    {payment.gateway && payment.charged_amount != null && <small>Charged {formatMoney(payment.charged_amount)}</small>}
                  </td>
                  <td>
                    <StatusBadge status={payment.status} />
                    {payment.gateway && payment.escrow_status !== 'none' && <small>Escrow: {ESCROW_LABEL[payment.escrow_status]}</small>}
                    {payment.payout_status === 'due' && <small>Payout due</small>}
                    {payment.payout_status === 'paid_out' && <small>Paid out</small>}
                    {payment.refund_status === 'due' && <small>Refund due</small>}
                    {payment.refund_status === 'sent' && <small>Refund sent</small>}
                  </td>
                  <td>{formatDate(payment.paid_at || payment.created_at)}</td>
                  {isMain && (
                    <td>
                      <div className="row-actions">
                        {['held', 'disputed'].includes(payment.escrow_status) && (
                          <>
                            <button className="btn btn-sm" disabled={actions.busy} onClick={act(`/admin/payments/${payment.id}/escrow`, { action: 'release' }, 'Released to the provider.', 'Release this money to the provider?')}>
                              Release
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={act(`/admin/payments/${payment.id}/escrow`, { action: 'refund' }, 'Refund approved.', 'Refund this money to the seeker?')}>
                              Refund
                            </button>
                          </>
                        )}
                        {payment.payout_status === 'due' && (
                          <button className="btn btn-sm" disabled={actions.busy} onClick={() => payout(payment)}>Mark paid out</button>
                        )}
                        {payment.refund_status === 'due' && (
                          <button className="btn btn-soft btn-sm" disabled={actions.busy} onClick={act(`/admin/payments/${payment.id}/refund-sent`, {}, 'Refund marked as sent.', 'Have you already sent the refund to the seeker?')}>
                            Refund sent
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- Disputes ----------

export function AdminDisputes() {
  const { user } = useAuth();
  const isMain = !!user.is_main_admin;
  const [status, setStatus] = useState('open');
  const [notes, setNotes] = useState({});

  const { data, loading, error, reload } = useLoad(async () => (await apiFetch(`/admin/disputes${status ? `?status=${status}` : ''}`)).disputes, [status]);
  const actions = useActions(reload);

  function decide(dispute, action) {
    const note = (notes[dispute.id] || '').trim();
    if (!note) {
      actions.setError('Write a short note first. Both people will see it.');
      return;
    }
    actions.run(() => apiFetch(`/admin/disputes/${dispute.id}`, { method: 'PATCH', body: { action, note } }));
  }

  return (
    <>
      <div className="tabs">
        {[['open', 'Open'], ['', 'All']].map(([key, label]) => (
          <button key={label} className={`tab ${status === key ? 'on' : ''}`} onClick={() => setStatus(key)}>{label}</button>
        ))}
      </div>

      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="No disputes" text="Nothing needs a decision right now." />}

      <div className="stack">
        {data?.map((dispute) => {
          const heldMoney = ['held', 'disputed'].includes(dispute.escrow_status);
          return (
            <article className="card" key={dispute.id}>
              <div className="card-row">
                <h3>{dispute.title}</h3>
                <StatusBadge status={dispute.status === 'open' ? 'pending' : 'completed'} />
              </div>
              <p>{dispute.reason}</p>
              <div className="meta">
                <span>From <b>{dispute.opener_name}</b> about <b>{dispute.against_name}</b></span>
                <span>{formatDateTime(dispute.created_at)}</span>
                {dispute.payment_id && <span>Payment #{dispute.payment_id}{dispute.escrow_status !== 'none' ? ` · ${ESCROW_LABEL[dispute.escrow_status] || dispute.escrow_status}` : ''}</span>}
              </div>

              {dispute.status === 'open' ? (
                <>
                  <label className="field">
                    <span>Your decision note (shown to both people)</span>
                    <textarea value={notes[dispute.id] || ''} maxLength={500} onChange={(event) => setNotes((current) => ({ ...current, [dispute.id]: event.target.value }))} />
                  </label>
                  <div className="card-actions">
                    {isMain && heldMoney && (
                      <>
                        <button className="btn btn-sm" disabled={actions.busy} onClick={() => decide(dispute, 'release')}>Pay the provider</button>
                        <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={() => decide(dispute, 'refund')}>Refund the seeker</button>
                      </>
                    )}
                    <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => decide(dispute, 'dismiss')}>Close without money change</button>
                  </div>
                  {!isMain && heldMoney && <small className="quote">Only the main admin can release or refund money.</small>}
                </>
              ) : (
                <p className="quote"><b>{dispute.status}</b>: {dispute.resolution_note}</p>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

// ---------- Fees, referral bonus and promo codes ----------

export function AdminFees() {
  const { user } = useAuth();
  const isMain = !!user.is_main_admin;

  const { data, loading, error, reload } = useLoad(async () => {
    const [settings, promos] = await Promise.all([apiFetch('/admin/settings'), apiFetch('/admin/promos')]);
    return { settings: settings.settings, promos: promos.promos };
  });
  const actions = useActions(reload);

  const [settings, setSettings] = useState(null);
  const [promo, setPromo] = useState({ code: '', kind: 'fixed', value: '', max_uses: '', expires_on: '' });

  const current = settings || data?.settings;
  const dirty = settings && data && (Number(settings.fee_percent) !== data.settings.fee_percent || Number(settings.referral_bonus) !== data.settings.referral_bonus);

  async function saveSettings(event) {
    event.preventDefault();
    const ok = await actions.run(() => apiFetch('/admin/settings', {
      method: 'PUT',
      body: { fee_percent: Number(current.fee_percent), referral_bonus: Number(current.referral_bonus) },
    }));
    if (ok) setSettings(null);
  }

  async function createPromo(event) {
    event.preventDefault();
    const ok = await actions.run(() => apiFetch('/admin/promos', {
      method: 'POST',
      body: { ...promo, value: Number(promo.value), max_uses: promo.max_uses === '' ? null : Number(promo.max_uses), expires_on: promo.expires_on || null },
    }));
    if (ok) setPromo({ code: '', kind: 'fixed', value: '', max_uses: '', expires_on: '' });
  }

  const toggle = (item) => () =>
    actions.run(() => apiFetch(`/admin/promos/${item.id}/active`, { method: 'PATCH', body: { active: !item.active } }));

  if (loading && !data) return <Loading />;

  return (
    <div className="stack">
      <Feedback error={error || actions.error} notice={actions.notice} />

      {current && (
        <section className="panel">
          <h2>Service fee and rewards</h2>
          <p className="quote">
            The service fee is added on top of the price when a seeker pays online. The provider always receives the full price.
            Cash and Nagad payments sent directly to a provider carry no fee, because the platform never holds that money.
          </p>
          <form className="form" onSubmit={saveSettings}>
            <div className="form-row">
              <label className="field">
                <span>Service fee (%)</span>
                <input type="number" min="0" max="30" step="0.1" value={current.fee_percent} disabled={!isMain} onChange={(event) => setSettings({ ...current, fee_percent: event.target.value })} />
              </label>
              <label className="field">
                <span>Referral bonus (BDT, 0 turns it off)</span>
                <input type="number" min="0" max="5000" step="1" value={current.referral_bonus} disabled={!isMain} onChange={(event) => setSettings({ ...current, referral_bonus: event.target.value })} />
              </label>
            </div>
            {isMain ? (
              <div className="pg-actions">
                <button className="btn" disabled={!dirty || actions.busy}>Save settings</button>
              </div>
            ) : (
              <small className="quote">Only the main admin can change these.</small>
            )}
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Promo codes</h2>
        <p className="quote">A promo code lowers what the seeker pays online. The provider still receives the full price, so the discount comes out of the platform&apos;s share.</p>

        {isMain && (
          <form className="form" onSubmit={createPromo}>
            <div className="form-row">
              <label className="field">
                <span>Code</span>
                <input value={promo.code} onChange={(event) => setPromo({ ...promo, code: event.target.value.toUpperCase() })} maxLength={30} placeholder="e.g. EID25" required />
              </label>
              <label className="field">
                <span>Type</span>
                <select value={promo.kind} onChange={(event) => setPromo({ ...promo, kind: event.target.value })}>
                  <option value="fixed">Fixed amount (BDT)</option>
                  <option value="percent">Percent</option>
                </select>
              </label>
              <label className="field">
                <span>{promo.kind === 'percent' ? 'Percent off' : 'BDT off'}</span>
                <input type="number" min="1" step="0.01" value={promo.value} onChange={(event) => setPromo({ ...promo, value: event.target.value })} required />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Total uses (empty = unlimited)</span>
                <input type="number" min="1" value={promo.max_uses} onChange={(event) => setPromo({ ...promo, max_uses: event.target.value })} />
              </label>
              <label className="field">
                <span>Expires on (optional)</span>
                <input type="date" value={promo.expires_on} onChange={(event) => setPromo({ ...promo, expires_on: event.target.value })} />
              </label>
            </div>
            <div className="pg-actions">
              <button className="btn" disabled={actions.busy}>Create code</button>
            </div>
          </form>
        )}

        {data?.promos.length === 0 && <Empty title="No promo codes" text="Create one above." />}

        {data?.promos.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Used</th>
                  <th>Expires</th>
                  <th>For</th>
                  {isMain && <th />}
                </tr>
              </thead>
              <tbody>
                {data.promos.map((item) => (
                  <tr key={item.id}>
                    <td><b>{item.code}</b><small>{item.active ? 'On' : 'Off'}</small></td>
                    <td>{item.kind === 'percent' ? `${Number(item.value)}%` : formatMoney(item.value)}</td>
                    <td>{item.used_count}{item.max_uses ? ` / ${item.max_uses}` : ''}</td>
                    <td>{item.expires_on ? formatDate(item.expires_on) : 'Never'}</td>
                    <td>{item.user_name || 'Everyone'}</td>
                    {isMain && (
                      <td>
                        <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={toggle(item)}>{item.active ? 'Turn off' : 'Turn on'}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
