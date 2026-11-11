import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { Feedback, Loading, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** Provider: choose which payment methods customers can use. */
export default function PaymentSettings() {
  const { data, loading } = useLoad(async () => (await apiFetch('/payment-settings')).settings);
  const [form, setForm] = useState(null);
  const { busy, error, notice, run } = useActions();

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading || !form) return <Loading />;

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function save(event) {
    event.preventDefault();
    run(() => apiFetch('/payment-settings', { method: 'PUT', body: form }));
  }

  return (
    <section className="panel">
      <h2>Payment methods</h2>
      <p className="sub">Choose how customers can pay you. They will see these numbers only after you are hired or booked.</p>

      <Feedback error={error} notice={notice} />

      <form className="form" onSubmit={save}>
        <label className="check">
          <input
            type="checkbox"
            checked={form.accepts_cash}
            onChange={(event) => setForm({ ...form, accepts_cash: event.target.checked })}
          />
          <span>
            <b><Icon name="cash" /> Cash on delivery</b>
            <small>Customer pays you in person when the work is done.</small>
          </span>
        </label>

        <div className="form-row">
          <label className="field">
            <span><Icon name="mobile" /> bKash number</span>
            <input value={form.bkash_number} onChange={set('bkash_number')} inputMode="tel" placeholder="01XXXXXXXXX (leave empty to disable)" />
          </label>
          <label className="field">
            <span><Icon name="mobile" /> Nagad number</span>
            <input value={form.nagad_number} onChange={set('nagad_number')} inputMode="tel" placeholder="01XXXXXXXXX (leave empty to disable)" />
          </label>
        </div>

        <div>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving...' : 'Save payment methods'}
          </button>
        </div>
      </form>
    </section>
  );
}
