import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { Feedback, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** Choose how important updates reach you outside the app. */
export default function NotificationPreferences({ me, onSaved }) {
  const { data: config } = useLoad(() => apiFetch('/config', { auth: false }));
  const [form, setForm] = useState({ notify_email: me.notify_email, notify_sms: me.notify_sms });
  const { busy, error, notice, run } = useActions(onSaved);

  useEffect(() => {
    setForm({ notify_email: me.notify_email, notify_sms: me.notify_sms });
  }, [me.notify_email, me.notify_sms]);

  const smsReady = config?.sms_available;

  function save(event) {
    event.preventDefault();
    run(() => apiFetch('/me/preferences', { method: 'PUT', body: form }));
  }

  return (
    <section className="panel">
      <h2>Email and SMS alerts</h2>
      <p className="sub">
        In-app and browser alerts are always on. Choose what else reaches you when something important happens
        (applications, bookings, payments, verification).
      </p>

      <Feedback error={error} notice={notice} />

      <form className="form" onSubmit={save}>
        <label className="check">
          <input
            type="checkbox"
            checked={form.notify_email}
            onChange={(event) => setForm({ ...form, notify_email: event.target.checked })}
          />
          <span>
            <b><Icon name="mail" /> Email me</b>
            <small>
              Sent to {me.email}.
            </small>
          </span>
        </label>

        <label className="check" style={smsReady ? undefined : { opacity: 0.6 }}>
          <input
            type="checkbox"
            checked={form.notify_sms}
            disabled={!smsReady}
            onChange={(event) => setForm({ ...form, notify_sms: event.target.checked })}
          />
          <span>
            <b><Icon name="chat" /> Text me (SMS)</b>
            <small>
              {smsReady
                ? `Only for urgent updates, sent to ${me.phone || 'the mobile number in your profile (add one above)'}.`
                : 'Not available yet. The site owner has not connected an SMS provider.'}
            </small>
          </span>
        </label>

        <div>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving...' : 'Save alert settings'}
          </button>
        </div>
      </form>
    </section>
  );
}
