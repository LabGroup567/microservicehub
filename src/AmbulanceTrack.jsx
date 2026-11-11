import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from './api.js';
import { useAuth } from './auth.jsx';
import LiveMap from './LiveMap.jsx';
import { Empty, Feedback, Loading, PageHead, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

export function ago(seconds) {
  if (seconds == null) return 'no position yet';
  if (seconds < 20) return 'just now';
  if (seconds < 90) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}

/** The ambulance you chose, live on a map. Updates every few seconds. */
export default function AmbulanceTrack() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch(`/ambulances/requests/${id}`)).request, [id]);
  const actions = useActions(reload);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => reload(true), 8000);
    const clock = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [reload]);

  const points = useMemo(() => {
    const l = data?.location;
    if (!l) return [];
    return [{ key: 'ambulance', lat: l.lat, lng: l.lng, color: l.live ? '#c2410c' : '#8a8f8c', label: l.live ? data.ambulance.name : `${data.ambulance.name} (last seen)` }];
  }, [data]);

  if (error && !data) {
    return (
      <div className="pg">
        <Empty title="Not found" text={error} action={<button className="btn" onClick={() => navigate('/emergency/ambulances')}>Back to ambulances</button>} />
      </div>
    );
  }
  if (loading && !data) return <div className="pg"><Loading /></div>;
  if (!data) return null;

  const active = data.status === 'active';
  const isAdmin = user.role === 'admin';
  const loc = data.location;
  const ageNow = loc?.age_seconds;

  return (
    <div className="pg">
      <PageHead title={data.ambulance.name} subtitle={active ? 'Your ambulance. The map updates by itself.' : `This request is ${data.status}.`} />
      <Feedback error={actions.error} notice={actions.notice} />

      {active && (
        <>
          <section className="panel amb-live">
            <div className="card-row">
              <h2><Icon name="ambulance" /> {data.ambulance.name}</h2>
              <span className={`badge ${loc?.live ? 'badge-info' : 'badge-warn'}`}>{loc ? (loc.live ? 'Live' : 'Last seen') : 'Waiting for position'}</span>
            </div>
            <p className="quote">
              {loc ? `Position updated ${ago(ageNow)}.` : 'The driver has not shared the position yet. You can call the driver now.'}
            </p>
            <div className="amb-driver">
              <div>
                <b>{data.ambulance.driver_name}</b>
                <small>{data.ambulance.vehicle_no || 'Driver'}</small>
              </div>
              <a className="btn btn-sm" href={`tel:${data.ambulance.phone}`}><Icon name="phone" /> Call {data.ambulance.phone}</a>
            </div>
          </section>

          {points.length > 0 && (
            <div className="nearby-map">
              <LiveMap points={points} />
            </div>
          )}

          <section className="panel">
            <h2>Pickup</h2>
            <p>{data.pickup}</p>
            {data.note && <p className="hint">{data.note}</p>}
            {isAdmin && <p className="hint">Requested by {data.user_name} · {data.patient_phone}</p>}
          </section>

          <div className="card-actions">
            {isAdmin ? (
              <button className="btn" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/ambulances/requests/${data.id}`, { method: 'PATCH', body: { status: 'completed' } }))}>
                Mark trip completed
              </button>
            ) : (
              <button className="btn btn-ghost" disabled={actions.busy} onClick={() => actions.run(() => apiFetch(`/ambulances/requests/${data.id}`, { method: 'PATCH', body: { status: 'cancelled' } }))}>
                Cancel ambulance
              </button>
            )}
          </div>
        </>
      )}

      {!active && (
        <Empty title={data.status === 'completed' ? 'Trip completed' : 'Request closed'} text="The ambulance position is no longer shared." action={<button className="btn" onClick={() => navigate('/emergency/ambulances')}>Back to ambulances</button>} />
      )}
    </div>
  );
}
