import { useState } from 'react';
import { apiFetch, formatDateTime, formatMoney } from './api.js';
import { useAuth } from './auth.jsx';
import { Empty, Feedback, Loading, Modal, PageHead, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const STATUS = {
  pending: ['Waiting for admin', 'badge-warn'],
  approved: ['Approved', 'badge-info'],
  rejected: ['Not approved', 'badge-danger'],
  cancelled: ['Cancelled', 'badge-muted'],
  completed: ['Completed', 'badge-muted'],
};

/** Doctors added by the admins. Ask for a checkup; an admin approves and sends the meeting link. */
export default function Doctors() {
  const { user } = useAuth();
  const doctors = useLoad(async () => (await apiFetch('/doctors')).doctors);
  const mine = useLoad(async () => (await apiFetch('/checkups/mine')).checkups);
  const [asking, setAsking] = useState(null);
  const [form, setForm] = useState({ reason: '', preferred_time: '' });
  const actions = useActions(async () => {
    await mine.reload();
  });
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const isAdmin = user.role === 'admin';

  async function send(event) {
    event.preventDefault();
    const ok = await actions.run(() => apiFetch('/checkups', { method: 'POST', body: { doctor_id: asking.id, ...form } }));
    if (ok) {
      setAsking(null);
      setForm({ reason: '', preferred_time: '' });
    }
  }

  const requests = mine.data || [];

  return (
    <div className="pg">
      <PageHead title="Doctors" subtitle="Press Checkup and describe the problem. An admin approves it and sends you the meeting link." />

      <p className="em-warning">
        <b>This is not for emergencies.</b> For chest pain, heavy bleeding or trouble breathing, call 999 or go to the nearest hospital.
      </p>

      <Feedback error={doctors.error || actions.error} notice={actions.notice} />

      {requests.length > 0 && (
        <section className="panel">
          <h2>Your checkups</h2>
          <div className="stack">
            {requests.map((c) => (
              <article className="card" key={c.id}>
                <div className="card-row">
                  <div>
                    <h3>{c.doctor_name}</h3>
                    <small>{c.specialty} · asked {formatDateTime(c.created_at)}</small>
                  </div>
                  <span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
                </div>
                <p>{c.reason}</p>
                {c.status === 'approved' && (
                  <div className="doc-meet">
                    <p>
                      {c.meeting_time ? <>Time: <b>{c.meeting_time}</b></> : 'The meeting is ready.'}
                    </p>
                    <a className="btn btn-sm" href={c.meeting_link} target="_blank" rel="noopener noreferrer"><Icon name="doctor" /> Join the meeting</a>
                  </div>
                )}
                {c.admin_note && <p className="hint">Admin: {c.admin_note}</p>}
                {['pending', 'approved'].includes(c.status) && (
                  <div className="card-actions">
                    <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/checkups/${c.id}/cancel`, { method: 'PATCH' }))}>
                      Cancel
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="ex-title"><h2>Available doctors</h2></div>
      {doctors.loading && !doctors.data && <Loading text="Loading doctors..." variant="cards" />}
      {doctors.data && doctors.data.length === 0 && <Empty title="No doctor yet" text="The admin team has not added a doctor yet. For advice now, call the Health Call Centre on 16263." />}

      <div className="stack">
        {doctors.data?.map((d) => (
          <article className="card" key={d.id}>
            <div className="card-row">
              <div className="amb-name">
                <span className="amb-ico doc-ico" aria-hidden="true"><Icon name="doctor" /></span>
                <div>
                  <h3>{d.full_name}</h3>
                  <small>{d.specialty}{d.qualification ? ` · ${d.qualification}` : ''}</small>
                </div>
              </div>
              <b>{d.fee ? formatMoney(d.fee) : 'Free'}</b>
            </div>
            {d.bio && <p>{d.bio}</p>}
            <small className="hint">Registration no. {d.reg_no}</small>
            {!isAdmin && (
              <div className="card-actions">
                <button className="btn btn-sm" onClick={() => setAsking(d)}>Checkup</button>
              </div>
            )}
          </article>
        ))}
      </div>

      {asking && (
        <Modal title={`Checkup with ${asking.full_name}`} subtitle="An admin reads this, approves it and sends you a meeting link." onClose={() => setAsking(null)}>
          <Feedback error={actions.error} />
          <form className="form" onSubmit={send}>
            <label className="field">
              <span>What is the problem?</span>
              <textarea value={form.reason} onChange={set('reason')} maxLength={500} placeholder="For example: fever for two days, cough, headache" required />
            </label>
            <label className="field">
              <span>Best time (optional)</span>
              <input value={form.preferred_time} onChange={set('preferred_time')} maxLength={100} placeholder="e.g. Tonight after 9 pm" />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAsking(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Sending...' : 'Send request'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
