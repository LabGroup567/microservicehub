import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, formatDate } from './api.js';
import { Avatar, Empty, Feedback, Loading, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const TABS = [
  ['donors', 'Find donors'],
  ['requests', 'Requests'],
  ['donate', 'Be a donor'],
];

function ago(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function daysSince(day) {
  if (!day) return null;
  return Math.floor((Date.now() - new Date(day).getTime()) / 86400000);
}

const Group = ({ value }) => <span className="bl-group" aria-label={`Blood group ${value}`}>{value}</span>;

// ---------- Find donors ----------

function Donors({ goRequests }) {
  const [group, setGroup] = useState('');
  const [area, setArea] = useState('');
  const [eligible, setEligible] = useState(false);

  const { data, loading, error } = useLoad(() => {
    const query = new URLSearchParams();
    if (group) query.set('group', group);
    if (area.trim()) query.set('area', area.trim());
    if (eligible) query.set('eligible', '1');
    return apiFetch(`/blood/donors?${query}`);
  }, [group, area, eligible]);

  const donors = data?.donors || [];

  return (
    <>
      <div className="filters compact">
        <label className="field">
          <span>Blood group</span>
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">Any group</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Area</span>
          <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. Mirpur" />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={eligible} onChange={(event) => setEligible(event.target.checked)} />
          <span>Ready to donate now</span>
        </label>
      </div>

      <Feedback error={error} />
      {loading && !data && <Loading text="Looking for donors..." variant="cards" />}

      {data && donors.length === 0 && (
        <Empty
          title="No donors found"
          text="Try another area or group. You can also post a request, and donors of that group are told at once."
          action={<button className="btn" onClick={goRequests}>Ask for blood</button>}
        />
      )}

      <div className="stack">
        {donors.map((d) => {
          const since = daysSince(d.last_donated);
          return (
            <article className="card bl-card" key={d.id}>
              <Group value={d.blood_group} />
              <div className="bl-main">
                <div className="person">
                  <Avatar name={d.full_name} imageId={d.avatar_image_id} />
                  <div>
                    <strong>{d.full_name}</strong>
                    <small><Icon name="pin" /> {d.area}</small>
                  </div>
                </div>
                <small className={d.eligible_now ? 'bl-ready' : 'bl-rest'}>
                  {d.eligible_now ? '● Ready to donate' : `Resting. Gave blood ${since} days ago`}
                </small>
              </div>
              {d.phone ? (
                <a className="btn btn-sm" href={`tel:${d.phone}`}><Icon name="phone" /> Call</a>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={goRequests} title="This donor keeps their number private">
                  Ask via request
                </button>
              )}
            </article>
          );
        })}
      </div>

      {data && donors.length > 0 && <p className="hint">Numbers are private unless a donor chooses to share. Post a request and donors can answer you directly.</p>}
    </>
  );
}

// ---------- Requests ----------

const BLANK_REQUEST = { blood_group: 'O+', units: 1, hospital: '', area: '', contact_phone: '', note: '', urgent: true };

function Requests() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK_REQUEST);
  const [group, setGroup] = useState('');
  const [shown, setShown] = useState({});

  const board = useLoad(() => apiFetch(`/blood/requests${group ? `?group=${encodeURIComponent(group)}` : ''}`), [group]);
  const mine = useLoad(() => apiFetch('/blood/requests/mine'));
  const actions = useActions(async () => {
    await Promise.all([board.reload(), mine.reload()]);
  });

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function post(event) {
    event.preventDefault();
    const ok = await actions.run(
      () => apiFetch('/blood/requests', { method: 'POST', body: { ...form, units: Number(form.units) } }),
      'Your request is posted. Donors of this group are being told.'
    );
    if (ok) {
      setForm(BLANK_REQUEST);
      setOpen(false);
    }
  }

  async function offer(request) {
    if (!window.confirm(`Share your name and phone number with the family so they can call you about ${request.blood_group} blood?`)) return;
    try {
      const result = await apiFetch(`/blood/requests/${request.id}/offer`, { method: 'POST' });
      setShown((current) => ({ ...current, [request.id]: result }));
      board.reload();
    } catch (err) {
      actions.setError(err.message);
    }
  }

  const requests = board.data?.requests || [];
  const myOpen = (mine.data?.requests || []).filter((r) => r.status === 'open' && !r.expired);

  return (
    <>
      <div className="bl-bar">
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close the form' : <><Icon name="drop" /> Ask for blood</>}
        </button>
        <label className="field bl-filter">
          <span className="sr-only">Blood group</span>
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">All groups</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>

      <Feedback error={actions.error || board.error} notice={actions.notice} />

      {open && (
        <form className="panel form bl-form" onSubmit={post}>
          <h2>Ask for blood</h2>
          <p className="sub">Donors with this blood group are told at once. Your number is shown only to donors who say they can donate.</p>
          <div className="form-row">
            <label className="field">
              <span>Blood group</span>
              <select value={form.blood_group} onChange={set('blood_group')}>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Bags needed</span>
              <input type="number" min="1" max="10" value={form.units} onChange={set('units')} required />
            </label>
          </div>
          <label className="field">
            <span>Hospital or place</span>
            <input value={form.hospital} onChange={set('hospital')} maxLength={150} placeholder="e.g. Square Hospital" required />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Area</span>
              <input value={form.area} onChange={set('area')} maxLength={100} placeholder="e.g. Panthapath, Dhaka" required />
            </label>
            <label className="field">
              <span>Phone to call</span>
              <input type="tel" value={form.contact_phone} onChange={set('contact_phone')} placeholder="01XXXXXXXXX" required />
            </label>
          </div>
          <label className="field">
            <span>Note (optional)</span>
            <textarea value={form.note} onChange={set('note')} maxLength={300} placeholder="Patient name, ward or bed number, time needed" />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={form.urgent} onChange={set('urgent')} />
            <span>This is urgent</span>
          </label>
          <button className="btn" disabled={actions.busy}>{actions.busy ? 'Posting...' : 'Post request'}</button>
        </form>
      )}

      {myOpen.length > 0 && (
        <section className="panel">
          <h2>Your requests</h2>
          {myOpen.map((r) => (
            <div className="bl-mine" key={r.id}>
              <div className="card-row">
                <div>
                  <Group value={r.blood_group} /> <b>{r.units} {r.units === 1 ? 'bag' : 'bags'}</b> at {r.hospital}, {r.area}
                </div>
                <div className="card-actions">
                  <button className="btn btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/blood/requests/${r.id}`, { method: 'PATCH', body: { status: 'fulfilled' } }))}>
                    We found blood
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/blood/requests/${r.id}`, { method: 'PATCH', body: { status: 'closed' } }))}>
                    Close
                  </button>
                </div>
              </div>
              {r.offers.length === 0 ? (
                <p className="hint">No donor has answered yet. Valid until {formatDate(r.expires_at)}.</p>
              ) : (
                <ul className="bl-offers">
                  {r.offers.map((o) => (
                    <li key={o.donor_id}>
                      <b>{o.full_name}</b> can donate · <a href={`tel:${o.phone}`}><Icon name="phone" /> {o.phone}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="ex-title"><h2>Open requests</h2></div>
      {board.loading && !board.data && <Loading text="Loading requests..." variant="cards" />}
      {board.data && requests.length === 0 && (
        <Empty title="No open requests" text="When someone needs blood, the request shows here and donors of that group are told." />
      )}

      <div className="stack">
        {requests.map((r) => (
          <article className={`card bl-card ${r.urgent ? 'bl-urgent' : ''}`} key={r.id}>
            <Group value={r.blood_group} />
            <div className="bl-main">
              <strong>
                {r.units} {r.units === 1 ? 'bag' : 'bags'} needed {r.urgent && <span className="badge badge-danger">Urgent</span>}
              </strong>
              <small><Icon name="hospital" /> {r.hospital} · <Icon name="pin" /> {r.area}</small>
              {r.note && <small>{r.note}</small>}
              <small>
                Asked by {r.requester_name} · {ago(r.created_at)} · {r.offers} {r.offers === 1 ? 'donor' : 'donors'} answered
              </small>
              {shown[r.id] && (
                <div className="bl-reveal">
                  <p>{shown[r.id].message}</p>
                  <a className="btn btn-sm" href={`tel:${shown[r.id].contact_phone}`}><Icon name="phone" /> Call {shown[r.id].contact_phone}</a>
                </div>
              )}
            </div>
            {r.mine ? (
              <span className="badge badge-muted">Your request</span>
            ) : r.i_offered || shown[r.id] ? (
              <span className="badge">You answered</span>
            ) : (
              <button className="btn btn-sm" onClick={() => offer(r)}>I can donate</button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

// ---------- Be a donor ----------

function BeADonor() {
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/blood/me')).donor);
  const actions = useActions(reload);
  const [form, setForm] = useState({ blood_group: 'O+', area: '', is_available: true, share_phone: false, last_donated: '' });

  useEffect(() => {
    if (data) setForm({ blood_group: data.blood_group, area: data.area, is_available: data.is_available, share_phone: data.share_phone, last_donated: data.last_donated ? String(data.last_donated).slice(0, 10) : '' });
  }, [data]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  function save(event) {
    event.preventDefault();
    actions.run(() => apiFetch('/blood/me', { method: 'PUT', body: { ...form, last_donated: form.last_donated || null } }));
  }

  if (loading && !data) return <Loading text="Loading..." />;

  return (
    <form className="panel form" onSubmit={save}>
      <h2>{data ? 'Your donor profile' : 'Become a blood donor'}</h2>
      <p className="sub">One bag can save up to three lives. You decide who sees your number. You can switch off or leave at any time.</p>
      <Feedback error={actions.error || error} notice={actions.notice} />

      <div className="form-row">
        <label className="field">
          <span>Blood group</span>
          <select value={form.blood_group} onChange={set('blood_group')}>
            {GROUPS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Area you live in</span>
          <input value={form.area} onChange={set('area')} maxLength={100} placeholder="e.g. Mirpur, Dhaka" required />
        </label>
      </div>
      <label className="field">
        <span>Last time you gave blood (optional)</span>
        <input type="date" value={form.last_donated} max={new Date().toISOString().slice(0, 10)} onChange={set('last_donated')} />
        <small className="hint">Donors rest about 3 months between donations. We will not alert you before that.</small>
      </label>
      <label className="check-field">
        <input type="checkbox" checked={form.is_available} onChange={set('is_available')} />
        <span>I am available to donate</span>
      </label>
      <label className="check-field">
        <input type="checkbox" checked={form.share_phone} onChange={set('share_phone')} />
        <span>Show my phone number to people looking for donors</span>
      </label>

      <div className="card-actions">
        <button className="btn" disabled={actions.busy}>{actions.busy ? 'Saving...' : data ? 'Save changes' : 'Join the donor list'}</button>
        {data && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={actions.busy}
            onClick={() => window.confirm('Remove yourself from the donor list?') && actions.run(() => apiFetch('/blood/me', { method: 'DELETE' }))}
          >
            Remove me
          </button>
        )}
      </div>
    </form>
  );
}

/** Blood bank: find a donor, ask for blood, or become a donor. */
export default function Blood() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'donors';
  const open = (key) => setParams({ tab: key }, { replace: true });

  return (
    <div className="em">
      <header className="em-hero em-hero-blood">
        <button type="button" className="ex-back" onClick={() => navigate('/emergency')} aria-label="Back to emergency help">‹</button>
        <div>
          <h1><Icon name="drop" /> Blood bank</h1>
          <p>Find a donor, ask for blood, or become a donor.</p>
        </div>
      </header>

      <div className="em-body">
        <div className="tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => open(key)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'donors' && <Donors goRequests={() => open('requests')} />}
        {tab === 'requests' && <Requests />}
        {tab === 'donate' && <BeADonor />}

        <p className="hint" style={{ marginTop: 18 }}>
          MicroServiceHub connects people but does not test or store blood. Always get blood from a licensed blood bank or hospital, and have it screened.
        </p>
      </div>
    </div>
  );
}
