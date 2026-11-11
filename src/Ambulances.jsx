import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';
import { useAuth } from './auth.jsx';
import { Empty, Feedback, Loading, Modal, PageHead, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** Ambulances added by the admins. Choose one that is free, and follow it on the map. */
export default function Ambulances() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const list = useLoad(async () => (await apiFetch('/ambulances')).ambulances);
  const mine = useLoad(async () => (await apiFetch('/ambulances/requests/mine')).request);
  const reloadList = list.reload;
  const [choosing, setChoosing] = useState(null);
  const [form, setForm] = useState({ pickup: '', phone: user?.phone || '', note: '' });
  const actions = useActions(async () => {
    await list.reload();
    await mine.reload();
  });

  // Keep the list fresh: another person may have taken an ambulance.
  useEffect(() => {
    const timer = window.setInterval(() => reloadList(true), 20000);
    return () => window.clearInterval(timer);
  }, [reloadList]);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const active = mine.data?.status === 'active' ? mine.data : null;
  const isAdmin = user.role === 'admin';

  async function choose(event) {
    event.preventDefault();
    let id = null;
    const ok = await actions.run(async () => {
      const result = await apiFetch(`/ambulances/${choosing.id}/request`, { method: 'POST', body: form });
      id = result.id;
      return result;
    });
    if (ok && id) navigate(`/emergency/ambulances/${id}`);
  }

  const free = (list.data || []).filter((a) => a.status === 'available').length;

  return (
    <div className="pg">
      <PageHead title="Ambulance" subtitle="Choose a free ambulance. You can follow it on the map once you choose." />

      <p className="em-warning">
        <b>If a life is at risk, call 999 first.</b> They can send an ambulance fastest.
      </p>

      <Feedback error={list.error || actions.error} notice={actions.notice} />

      {active && (
        <button type="button" className="ex-booking amb-active" onClick={() => navigate(`/emergency/ambulances/${active.id}`)}>
          <span className="ex-booking-ico" aria-hidden="true"><Icon name="ambulance" /></span>
          <span>
            <b>Your ambulance is on the way</b>
            <small>{active.ambulance.name}. Tap to follow it on the map.</small>
          </span>
          <span className="ex-chevron" aria-hidden="true">›</span>
        </button>
      )}

      {isAdmin && <p className="hint">You are an admin. Add and manage ambulances in Admin panel, Emergency tab.</p>}

      {list.loading && !list.data && <Loading text="Loading ambulances..." variant="cards" />}
      {list.data && list.data.length === 0 && <Empty title="No ambulance yet" text="The admin team has not added an ambulance yet. Please call 999 for now." />}
      {list.data && list.data.length > 0 && <p className="hint">{free} of {list.data.length} available now</p>}

      <div className="stack">
        {list.data?.map((a) => (
          <article className="card amb-card" key={a.id}>
            <div className="card-row">
              <div className="amb-name">
                <span className="amb-ico" aria-hidden="true"><Icon name="ambulance" /></span>
                <div>
                  <h3>{a.name}</h3>
                  <small>{a.area}{a.vehicle_no ? ` · ${a.vehicle_no}` : ''}</small>
                </div>
              </div>
              <span className={`badge ${a.status === 'available' ? 'badge-info' : 'badge-warn'}`}>{a.status === 'available' ? 'Available' : 'On a trip'}</span>
            </div>
            {!isAdmin && (
              <div className="card-actions">
                <button className="btn btn-sm" disabled={a.status !== 'available' || !!active || actions.busy} onClick={() => setChoosing(a)}>
                  Choose this ambulance
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {choosing && (
        <Modal title={`Choose ${choosing.name}`} subtitle="Tell the driver where to come. The driver can call you on this number." onClose={() => setChoosing(null)}>
          <Feedback error={actions.error} />
          <form className="form" onSubmit={choose}>
            <label className="field">
              <span>Pickup address</span>
              <input value={form.pickup} onChange={set('pickup')} maxLength={255} placeholder="House, road, area" required />
            </label>
            <label className="field">
              <span>Your phone</span>
              <input type="tel" value={form.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" required />
            </label>
            <label className="field">
              <span>Note (optional)</span>
              <textarea value={form.note} onChange={set('note')} maxLength={300} placeholder="Patient condition, floor, landmark" />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setChoosing(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Choosing...' : 'Confirm'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
