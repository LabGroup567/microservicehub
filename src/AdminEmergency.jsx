import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDateTime, formatMoney } from './api.js';
import LiveMap from './LiveMap.jsx';
import { ago } from './AmbulanceTrack.jsx';
import { Empty, Feedback, Loading, Modal, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const SUBTABS = [
  ['ambulances', 'Ambulances'],
  ['trips', 'Ambulance requests'],
  ['doctors', 'Doctors'],
  ['checkups', 'Checkup requests'],
  ['blood', 'Blood bank'],
];

/** Admin only: run the ambulances, doctors and the blood bank. */
export default function AdminEmergency() {
  const [sub, setSub] = useState('ambulances');
  return (
    <>
      <div className="tabs ex-tabs">
        {SUBTABS.map(([key, label]) => (
          <button key={key} className={`tab ${sub === key ? 'on' : ''}`} onClick={() => setSub(key)}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'ambulances' && <Ambulances />}
      {sub === 'trips' && <Trips />}
      {sub === 'doctors' && <Doctors />}
      {sub === 'checkups' && <Checkups />}
      {sub === 'blood' && <Blood />}
    </>
  );
}

// ---------------------------------------------------------------- ambulances

const EMPTY_AMB = { name: '', driver_name: '', phone: '', vehicle_no: '', area: '', status: 'available' };

function Ambulances() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/admin/ambulances')).ambulances);
  const actions = useActions(reload);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const points = useMemo(
    () =>
      (data || [])
        .filter((a) => a.location)
        .map((a) => ({ key: `a${a.id}`, lat: a.location.lat, lng: a.location.lng, color: a.location.live ? '#c2410c' : '#8a8f8c', label: a.location.live ? a.name : `${a.name} (last seen)` })),
    [data]
  );

  const set = (field) => (event) => setEditing((current) => ({ ...current, [field]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    const body = { ...editing };
    const ok = await actions.run(() => (editing.id ? apiFetch(`/admin/ambulances/${editing.id}`, { method: 'PUT', body }) : apiFetch('/admin/ambulances', { method: 'POST', body })));
    if (ok) setEditing(null);
  }

  const link = (a) => `${window.location.origin}/track/${a.track_token}`;

  async function copy(a) {
    try {
      await navigator.clipboard.writeText(link(a));
      actions.setNotice('Driver link copied. Send it to the driver by WhatsApp or SMS.');
    } catch {
      actions.setNotice(link(a));
    }
  }

  function shareMyPosition(a) {
    if (!navigator.geolocation) return actions.setError('This device cannot share its location.');
    navigator.geolocation.getCurrentPosition(
      (p) => actions.run(() => apiFetch(`/admin/ambulances/${a.id}/location`, { method: 'PATCH', body: { lat: p.coords.latitude, lng: p.coords.longitude } }), 'Position saved from this device.'),
      () => actions.setError('Could not read this device location. Allow location in the browser.'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  return (
    <>
      <div className="bl-bar">
        <button className="btn" onClick={() => setEditing({ ...EMPTY_AMB })}><Icon name="plus" /> Add ambulance</button>
      </div>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="No ambulance yet" text="Add your first ambulance. People will be able to choose it right away." />}

      {points.length > 0 && (
        <div className="nearby-map">
          <LiveMap points={points} />
        </div>
      )}

      <div className="stack">
        {data?.map((a) => (
          <article className="card" key={a.id}>
            <div className="card-row">
              <div className="amb-name">
                <span className="amb-ico" aria-hidden="true"><Icon name="ambulance" /></span>
                <div>
                  <h3>{a.name}</h3>
                  <small>{a.driver_name} · {a.phone}{a.vehicle_no ? ` · ${a.vehicle_no}` : ''} · {a.area}</small>
                </div>
              </div>
              <span className={`badge ${a.status === 'available' ? 'badge-info' : a.status === 'busy' ? 'badge-warn' : 'badge-muted'}`}>
                {a.status === 'available' ? 'Available' : a.status === 'busy' ? 'On a trip' : 'Off duty'}
              </span>
            </div>
            <p className="hint">
              {a.location ? `Position: ${a.location.live ? 'live' : 'last seen'}, updated ${ago(a.location.age_seconds)}.` : 'No position yet. Send the driver link, or use this device.'}
            </p>
            <div className="card-actions">
              <button className="btn btn-soft btn-sm" onClick={() => copy(a)}>Copy driver link</button>
              <button className="btn btn-soft btn-sm" onClick={() => shareMyPosition(a)}>Use my position</button>
              <button className="btn btn-soft btn-sm" onClick={() => setEditing({ ...a, vehicle_no: a.vehicle_no || '' })}>Edit</button>
              {a.active_request_id && (
                <button className="btn btn-soft btn-sm" onClick={() => navigate(`/emergency/ambulances/${a.active_request_id}`)}>Open trip</button>
              )}
              {removing === a.id ? (
                <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={async () => { await actions.run(() => apiFetch(`/admin/ambulances/${a.id}`, { method: 'DELETE' })); setRemoving(null); }}>
                  Yes, remove
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(a.id)}>Remove</button>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit ambulance' : 'Add ambulance'} onClose={() => setEditing(null)}>
          <Feedback error={actions.error} />
          <form className="form" onSubmit={save}>
            <label className="field"><span>Ambulance name</span><input value={editing.name} onChange={set('name')} maxLength={100} placeholder="e.g. City Care Ambulance 1" required /></label>
            <div className="form-row">
              <label className="field"><span>Driver name</span><input value={editing.driver_name} onChange={set('driver_name')} maxLength={100} required /></label>
              <label className="field"><span>Driver phone</span><input type="tel" value={editing.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" required /></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Area it serves</span><input value={editing.area} onChange={set('area')} maxLength={100} placeholder="e.g. Mirpur, Dhaka" required /></label>
              <label className="field"><span>Vehicle number (optional)</span><input value={editing.vehicle_no} onChange={set('vehicle_no')} maxLength={40} /></label>
            </div>
            {editing.id && editing.status !== 'busy' && (
              <label className="field">
                <span>Status</span>
                <select value={editing.status} onChange={set('status')}>
                  <option value="available">Available</option>
                  <option value="off">Off duty (hidden from people)</option>
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- ambulance trips

function Trips() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/admin/ambulance-requests?status=all')).requests);
  const actions = useActions(reload);

  return (
    <>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="No ambulance requests" text="When someone chooses an ambulance, it shows here." />}
      <div className="stack">
        {data?.map((r) => (
          <article className="card" key={r.id}>
            <div className="card-row">
              <h3>{r.ambulance.name}</h3>
              <span className={`badge ${r.status === 'active' ? 'badge-warn' : 'badge-muted'}`}>{r.status === 'active' ? 'On the way' : r.status === 'completed' ? 'Completed' : 'Cancelled'}</span>
            </div>
            <p><b>{r.user_name}</b> · <a href={`tel:${r.patient_phone}`}>{r.patient_phone}</a></p>
            <p>{r.pickup}</p>
            {r.note && <p className="hint">{r.note}</p>}
            <small className="hint">{formatDateTime(r.created_at)}</small>
            {r.status === 'active' && (
              <div className="card-actions">
                <button className="btn btn-soft btn-sm" onClick={() => navigate(`/emergency/ambulances/${r.id}`)}>Follow on map</button>
                <button className="btn btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/ambulances/requests/${r.id}`, { method: 'PATCH', body: { status: 'completed' } }))}>Mark completed</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- doctors

const EMPTY_DOC = { full_name: '', specialty: '', qualification: '', reg_no: '', fee: '0', bio: '', phone: '', is_active: true };

function Doctors() {
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/admin/doctors')).doctors);
  const actions = useActions(reload);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const set = (field) => (event) => setEditing((current) => ({ ...current, [field]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    const ok = await actions.run(() =>
      editing.id ? apiFetch(`/admin/doctors/${editing.id}`, { method: 'PUT', body: editing }) : apiFetch('/admin/doctors', { method: 'POST', body: editing })
    );
    if (ok) setEditing(null);
  }

  return (
    <>
      <div className="bl-bar">
        <button className="btn" onClick={() => setEditing({ ...EMPTY_DOC })}><Icon name="plus" /> Add doctor</button>
      </div>
      <p className="hint">You talk to each doctor yourself. Patients see the name, specialty, fee and registration number, never the phone.</p>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="No doctor yet" text="Add a doctor after you have spoken to them and checked their registration number." />}
      <div className="stack">
        {data?.map((d) => (
          <article className="card" key={d.id}>
            <div className="card-row">
              <div className="amb-name">
                <span className="amb-ico doc-ico" aria-hidden="true"><Icon name="doctor" /></span>
                <div>
                  <h3>{d.full_name}</h3>
                  <small>{d.specialty}{d.qualification ? ` · ${d.qualification}` : ''} · {d.fee ? formatMoney(d.fee) : 'Free'}</small>
                </div>
              </div>
              <span className={`badge ${d.is_active ? 'badge-info' : 'badge-muted'}`}>{d.is_active ? 'Shown' : 'Hidden'}</span>
            </div>
            <p className="hint">Reg. no. {d.reg_no}{d.phone ? ` · private phone ${d.phone}` : ''}</p>
            <div className="card-actions">
              <button className="btn btn-soft btn-sm" onClick={() => setEditing({ ...d, qualification: d.qualification || '', bio: d.bio || '', phone: d.phone || '' })}>Edit</button>
              {removing === d.id ? (
                <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={async () => { await actions.run(() => apiFetch(`/admin/doctors/${d.id}`, { method: 'DELETE' })); setRemoving(null); }}>Yes, remove</button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(d.id)}>Remove</button>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit doctor' : 'Add doctor'} onClose={() => setEditing(null)}>
          <Feedback error={actions.error} />
          <form className="form" onSubmit={save}>
            <label className="field"><span>Doctor name</span><input value={editing.full_name} onChange={set('full_name')} maxLength={100} placeholder="Dr. Full Name" required /></label>
            <div className="form-row">
              <label className="field"><span>Specialty</span><input value={editing.specialty} onChange={set('specialty')} maxLength={100} placeholder="e.g. Medicine" required /></label>
              <label className="field"><span>Registration no. (BMDC)</span><input value={editing.reg_no} onChange={set('reg_no')} maxLength={60} required /></label>
            </div>
            <label className="field"><span>Qualification (optional)</span><input value={editing.qualification} onChange={set('qualification')} maxLength={150} placeholder="e.g. MBBS, FCPS" /></label>
            <div className="form-row">
              <label className="field"><span>Fee (BDT)</span><input type="number" min="0" step="1" value={editing.fee} onChange={set('fee')} required /></label>
              <label className="field"><span>Private phone (optional)</span><input type="tel" value={editing.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" /></label>
            </div>
            <label className="field"><span>Short note for patients (optional)</span><textarea value={editing.bio} onChange={set('bio')} maxLength={300} /></label>
            <label className="check-field">
              <input type="checkbox" checked={editing.is_active} onChange={(event) => setEditing((current) => ({ ...current, is_active: event.target.checked }))} />
              <span>Show this doctor to patients</span>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- checkups

function Checkups() {
  const [status, setStatus] = useState('pending');
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch(`/admin/checkups?status=${status}`)).checkups, [status]);
  const actions = useActions(reload);
  const [deciding, setDeciding] = useState(null); // { checkup, mode }
  const [form, setForm] = useState({ meeting_link: '', meeting_time: '', admin_note: '' });
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  function open(checkup, mode) {
    setForm({ meeting_link: checkup.meeting_link || '', meeting_time: checkup.meeting_time || checkup.preferred_time || '', admin_note: checkup.admin_note || '' });
    setDeciding({ checkup, mode });
  }

  async function submit(event) {
    event.preventDefault();
    const body = deciding.mode === 'approved' ? { status: 'approved', meeting_link: form.meeting_link, meeting_time: form.meeting_time, admin_note: form.admin_note } : { status: 'rejected', admin_note: form.admin_note };
    const ok = await actions.run(() => apiFetch(`/admin/checkups/${deciding.checkup.id}`, { method: 'PATCH', body }));
    if (ok) setDeciding(null);
  }

  return (
    <>
      <div className="tabs">
        {['pending', 'approved', 'completed', 'rejected', 'cancelled'].map((key) => (
          <button key={key} className={`tab ${status === key ? 'on' : ''}`} onClick={() => setStatus(key)}>
            {key[0].toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="Nothing here" text={status === 'pending' ? 'No checkup is waiting for you.' : 'No checkups with this status.'} />}
      <div className="stack">
        {data?.map((c) => (
          <article className="card" key={c.id}>
            <div className="card-row">
              <h3>{c.user_name} → {c.doctor_name}</h3>
              <small>{formatDateTime(c.created_at)}</small>
            </div>
            <p>{c.reason}</p>
            <p className="hint">{c.specialty}{c.preferred_time ? ` · wants ${c.preferred_time}` : ''} · {c.user_phone ? <a href={`tel:${c.user_phone}`}>{c.user_phone}</a> : 'no phone'}</p>
            {c.meeting_link && <p className="hint">Meeting: <a href={c.meeting_link} target="_blank" rel="noopener noreferrer">{c.meeting_link}</a>{c.meeting_time ? ` · ${c.meeting_time}` : ''}</p>}
            {c.admin_note && <p className="hint">Note: {c.admin_note}</p>}
            {c.status === 'pending' && (
              <div className="card-actions">
                <button className="btn btn-sm" onClick={() => open(c, 'approved')}>Approve and send link</button>
                <button className="btn btn-ghost btn-sm" onClick={() => open(c, 'rejected')}>Reject</button>
              </div>
            )}
            {c.status === 'approved' && (
              <div className="card-actions">
                <button className="btn btn-soft btn-sm" onClick={() => open(c, 'approved')}>Edit link or time</button>
                <button className="btn btn-soft btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/admin/checkups/${c.id}`, { method: 'PATCH', body: { status: 'completed' } }))}>Mark completed</button>
              </div>
            )}
            <div className="card-actions">
              <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/admin/checkups/${c.id}`, { method: 'DELETE' }))}>Delete</button>
            </div>
          </article>
        ))}
      </div>

      {deciding && (
        <Modal
          title={deciding.mode === 'approved' ? 'Approve checkup' : 'Reject checkup'}
          subtitle={deciding.mode === 'approved' ? 'Paste the meeting link (Google Meet, Zoom, etc.). The patient gets it at once.' : 'Tell the patient why, so they can ask again or call a helpline.'}
          onClose={() => setDeciding(null)}
        >
          <Feedback error={actions.error} />
          <form className="form" onSubmit={submit}>
            {deciding.mode === 'approved' && (
              <>
                <label className="field"><span>Meeting link</span><input type="url" value={form.meeting_link} onChange={set('meeting_link')} placeholder="https://meet.google.com/..." required /></label>
                <label className="field"><span>Meeting time</span><input value={form.meeting_time} onChange={set('meeting_time')} maxLength={100} placeholder="e.g. Today 9:30 pm" /></label>
              </>
            )}
            <label className="field">
              <span>{deciding.mode === 'approved' ? 'Message to patient (optional)' : 'Reason'}</span>
              <textarea value={form.admin_note} onChange={set('admin_note')} maxLength={300} required={deciding.mode === 'rejected'} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeciding(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Sending...' : deciding.mode === 'approved' ? (deciding.checkup.status === 'approved' ? 'Update and send' : 'Approve and send') : 'Reject'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- blood bank

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const EMPTY_DONOR = { full_name: '', phone: '', blood_group: 'O+', area: '', last_donated: '', share_phone: true };
const EMPTY_REQUEST = { blood_group: 'O+', units: 1, hospital: '', area: '', contact_phone: '', note: '', urgent: false };

function Blood() {
  const { data, loading, error, reload } = useLoad(async () => await apiFetch('/admin/blood'));
  const actions = useActions(reload);
  const [adding, setAdding] = useState(null); // 'donor' | 'request'
  const [donor, setDonor] = useState(EMPTY_DONOR);
  const [request, setRequest] = useState(EMPTY_REQUEST);
  const setD = (field) => (event) => setDonor((current) => ({ ...current, [field]: event.target.value }));
  const setR = (field) => (event) => setRequest((current) => ({ ...current, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function addDonor(event) {
    event.preventDefault();
    const body = { ...donor, last_donated: donor.last_donated || undefined };
    const ok = await actions.run(() => {
      if (donor.kind === 'user') return apiFetch(`/admin/blood/donors/${donor.user_id}`, { method: 'PUT', body });
      if (donor.id) return apiFetch(`/admin/blood/managed/${donor.id}`, { method: 'PUT', body });
      return apiFetch('/admin/blood/managed', { method: 'POST', body });
    });
    if (ok) {
      setAdding(null);
      setDonor(EMPTY_DONOR);
    }
  }

  async function addRequest(event) {
    event.preventDefault();
    const ok = await actions.run(
      () => (request.id ? apiFetch(`/admin/blood/requests/${request.id}`, { method: 'PUT', body: request }) : apiFetch('/blood/requests', { method: 'POST', body: request })),
      request.id ? 'Request updated.' : 'Blood request posted. Matching donors were told.'
    );
    if (ok) {
      setAdding(null);
      setRequest(EMPTY_REQUEST);
    }
  }

  const dayOnly = (value) => (value ? String(value).slice(0, 10) : '');
  const editManaged = (d) => {
    setDonor({ id: d.id, kind: 'managed', full_name: d.full_name, phone: d.phone, blood_group: d.blood_group, area: d.area, last_donated: dayOnly(d.last_donated), share_phone: d.share_phone, is_available: d.is_available });
    setAdding('donor');
  };
  const editUser = (d) => {
    setDonor({ kind: 'user', user_id: d.user_id, full_name: d.full_name, blood_group: d.blood_group, area: d.area, last_donated: dayOnly(d.last_donated), is_available: d.is_available });
    setAdding('donor');
  };
  const editRequest = (r) => {
    setRequest({ id: r.id, blood_group: r.blood_group, units: r.units, hospital: r.hospital, area: r.area, contact_phone: r.contact_phone, note: r.note || '', urgent: r.urgent, status: r.status });
    setAdding('request');
  };

  const groupSelect = (value, onChange) => (
    <select value={value} onChange={onChange}>
      {GROUPS.map((g) => (
        <option key={g} value={g}>{g}</option>
      ))}
    </select>
  );

  const total = data ? data.donors.length + data.managed.length : 0;

  return (
    <>
      <div className="bl-bar">
        <button className="btn" onClick={() => { setDonor(EMPTY_DONOR); setAdding('donor'); }}><Icon name="plus" /> Add donor</button>
        <button className="btn btn-ghost" onClick={() => { setRequest(EMPTY_REQUEST); setAdding('request'); }}><Icon name="drop" /> Add blood request</button>
      </div>
      <p className="hint">You can add donors who phoned or walked in, and post blood requests yourself. People can also add themselves. Here you see all of it and remove what should not be there.</p>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="ex-title"><h2>Blood requests</h2></div>
          {data.requests.length === 0 && <Empty title="No requests" text="Blood requests show here." />}
          <div className="stack">
            {data.requests.map((r) => (
              <article className="card" key={r.id}>
                <div className="card-row">
                  <h3><span className="bl-group">{r.blood_group}</span> {r.units} {r.units === 1 ? 'bag' : 'bags'} at {r.hospital}</h3>
                  <span className={`badge ${r.status === 'open' && !r.expired ? 'badge-warn' : 'badge-muted'}`}>{r.status === 'open' && r.expired ? 'expired' : r.status}</span>
                </div>
                <p className="hint">{r.area} · {r.requester_name} · <a href={`tel:${r.contact_phone}`}>{r.contact_phone}</a> · {r.offers} donor{r.offers === 1 ? '' : 's'} answered{r.urgent ? ' · urgent' : ''}</p>
                <div className="card-actions">
                  <button className="btn btn-soft btn-sm" onClick={() => editRequest(r)}>Edit</button>
                  {r.status === 'open' && !r.expired && (
                    <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/admin/blood/requests/${r.id}`, { method: 'PATCH', body: { status: 'closed' } }))}>Close request</button>
                  )}
                  <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/admin/blood/requests/${r.id}`, { method: 'DELETE' }))}>Delete</button>
                </div>
              </article>
            ))}
          </div>

          <div className="ex-title"><h2>Blood donors</h2></div>
          {total === 0 && <Empty title="No donors" text="Add a donor, or wait for people to join the donor list." />}
          <div className="table-wrap">
            {total > 0 && (
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Group</th><th>Area</th><th>Phone</th><th>Ready</th><th /></tr>
                </thead>
                <tbody>
                  {data.managed.map((d) => (
                    <tr key={`m${d.id}`}>
                      <td>{d.full_name} <span className="badge badge-muted">Added by admin</span></td>
                      <td><span className="bl-group">{d.blood_group}</span></td>
                      <td>{d.area}</td>
                      <td>{d.phone}{d.share_phone ? '' : ' (private)'}</td>
                      <td>{d.is_available ? 'Yes' : 'No'}</td>
                      <td className="row-actions">
                        <button className="btn btn-soft btn-sm" onClick={() => editManaged(d)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/admin/blood/managed/${d.id}`, { method: 'DELETE' }))}>Remove</button>
                      </td>
                    </tr>
                  ))}
                  {data.donors.map((d) => (
                    <tr key={d.user_id}>
                      <td>{d.full_name}</td>
                      <td><span className="bl-group">{d.blood_group}</span></td>
                      <td>{d.area}</td>
                      <td>{d.phone || '-'}</td>
                      <td>{d.is_available ? 'Yes' : 'No'}</td>
                      <td className="row-actions">
                        <button className="btn btn-soft btn-sm" onClick={() => editUser(d)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/admin/blood/donors/${d.user_id}`, { method: 'DELETE' }))}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {adding === 'donor' && (
        <Modal
          title={donor.kind === 'user' ? 'Edit donor' : donor.id ? 'Edit blood donor' : 'Add blood donor'}
          subtitle={donor.kind === 'user' ? `${donor.full_name} keeps their own phone number and privacy choice.` : 'For someone who phoned or walked in. They do not need an account.'}
          onClose={() => setAdding(null)}
        >
          <Feedback error={actions.error} />
          <form className="form" onSubmit={addDonor}>
            {donor.kind !== 'user' && <label className="field"><span>Donor name</span><input value={donor.full_name} onChange={setD('full_name')} maxLength={100} required /></label>}
            <div className="form-row">
              <label className="field"><span>Blood group</span>{groupSelect(donor.blood_group, setD('blood_group'))}</label>
              {donor.kind !== 'user' && <label className="field"><span>Phone</span><input type="tel" value={donor.phone} onChange={setD('phone')} placeholder="01XXXXXXXXX" required /></label>}
            </div>
            <div className="form-row">
              <label className="field"><span>Area</span><input value={donor.area} onChange={setD('area')} maxLength={100} placeholder="e.g. Mirpur, Dhaka" required /></label>
              <label className="field"><span>Last donated (optional)</span><input type="date" value={donor.last_donated} onChange={setD('last_donated')} /></label>
            </div>
            {donor.kind !== 'user' && (
              <label className="check-field">
                <input type="checkbox" checked={donor.share_phone} onChange={(event) => setDonor((current) => ({ ...current, share_phone: event.target.checked }))} />
                <span>The donor agreed to show their number to people looking for blood</span>
              </label>
            )}
            {(donor.id || donor.kind === 'user') && (
              <label className="check-field">
                <input type="checkbox" checked={donor.is_available !== false} onChange={(event) => setDonor((current) => ({ ...current, is_available: event.target.checked }))} />
                <span>Ready to donate (shown in Find donors)</span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Saving...' : donor.kind === 'user' || donor.id ? 'Save' : 'Add donor'}</button>
            </div>
          </form>
        </Modal>
      )}

      {adding === 'request' && (
        <Modal title={request.id ? 'Edit blood request' : 'Add blood request'} subtitle={request.id ? 'Reopening a closed request gives it three more days.' : 'Donors with this blood group are told at once.'} onClose={() => setAdding(null)}>
          <Feedback error={actions.error} />
          <form className="form" onSubmit={addRequest}>
            <div className="form-row">
              <label className="field"><span>Blood group</span>{groupSelect(request.blood_group, setR('blood_group'))}</label>
              <label className="field"><span>Bags needed</span><input type="number" min="1" max="10" value={request.units} onChange={setR('units')} required /></label>
            </div>
            <label className="field"><span>Hospital or place</span><input value={request.hospital} onChange={setR('hospital')} maxLength={150} placeholder="e.g. Square Hospital" required /></label>
            <div className="form-row">
              <label className="field"><span>Area</span><input value={request.area} onChange={setR('area')} maxLength={100} placeholder="e.g. Panthapath, Dhaka" required /></label>
              <label className="field"><span>Phone to call</span><input type="tel" value={request.contact_phone} onChange={setR('contact_phone')} placeholder="01XXXXXXXXX" required /></label>
            </div>
            <label className="field"><span>Note (optional)</span><textarea value={request.note} onChange={setR('note')} maxLength={300} /></label>
            <label className="check-field"><input type="checkbox" checked={request.urgent} onChange={setR('urgent')} /><span>This is urgent</span></label>
            {request.id && (
              <label className="field">
                <span>Status</span>
                <select value={request.status} onChange={setR('status')}>
                  <option value="open">Open</option>
                  <option value="fulfilled">Blood found</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn" disabled={actions.busy}>{actions.busy ? 'Saving...' : request.id ? 'Save' : 'Post request'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
