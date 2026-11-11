import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api.js';
import LiveMap from './LiveMap.jsx';
import { useRealtime } from './realtime.jsx';
import { Empty, Feedback, Loading, useLoad } from './ui.jsx';

const COLORS = { seeker: '#175cd3', provider: '#1f6f50', admin: '#7a2e98' };

function since(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}

/** Providers who switched on "Available now": an approximate spot, live or last seen. */
function AvailableProviders() {
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useLoad(async () => (await apiFetch('/nearby-providers')).providers, [tick]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const providers = data || [];
  const points = providers.map((p) => ({
    key: `a${p.id}`,
    lat: p.lat,
    lng: p.lng,
    color: p.live ? '#c2410c' : '#8a8f8c',
    label: p.live ? p.full_name : `${p.full_name} (last seen)`,
  }));

  return (
    <>
      <section className="panel">
        <h2>Available providers</h2>
        <p className="quote">
          Providers who chose to show that they are available. The spot is approximate (about 500 m). It is live while their app is open and
          stays as last seen for up to 3 hours after they close it.
        </p>
        <Feedback error={error} />
        <div className="admin-map">{points.length > 0 ? <LiveMap points={points} /> : <div className="nearby-map-empty">Nobody is showing as available right now.</div>}</div>
        <div className="cal-legend">
          <span><i className="dot" style={{ background: '#c2410c' }} /> Active now</span>
          <span><i className="dot" style={{ background: '#8a8f8c' }} /> Last seen</span>
        </div>
      </section>

      {!loading && providers.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Services</th>
                <th>Map</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.full_name}</b></td>
                  <td>{p.live ? <span className="live-pill">● Active now</span> : `Last seen ${since(p.minutes_ago)}`}</td>
                  <td>{p.categories.join(', ') || '—'}</td>
                  <td>
                    <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">Open in Maps ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ago(timestamp, now) {
  if (!timestamp) return 'waiting for the first update';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

/** Everyone who is sharing live location right now, on one map. Updates as people move. */
export default function AdminLocations() {
  const { socket } = useRealtime();
  const { data, loading, error } = useLoad(async () => (await apiFetch('/admin/locations')).shares);
  const [shares, setShares] = useState({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (data) setShares(Object.fromEntries(data.map((share) => [`${share.from}:${share.to}`, share])));
  }, [data]);

  // Live feed from the server.
  useEffect(() => {
    if (!socket) return undefined;

    const onShare = (share) => {
      const key = `${share.from}:${share.to}`;
      setShares((current) => {
        const next = { ...current };
        if (share.active === false) delete next[key];
        else next[key] = { ...current[key], ...share };
        return next;
      });
    };

    socket.on('admin:location', onShare);
    return () => socket.off('admin:location', onShare);
  }, [socket]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const list = useMemo(
    () => Object.values(shares).filter((share) => !share.expires_at || share.expires_at > now).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [shares, now]
  );

  // One marker per person, even when they share with more than one person.
  const points = useMemo(() => {
    const byPerson = new Map();
    list.forEach((share) => {
      if (share.lat == null) return;
      const seen = byPerson.get(share.from);
      if (!seen || (share.updated_at || 0) > (seen.updated_at || 0)) byPerson.set(share.from, share);
    });
    return [...byPerson.values()].map((share) => ({
      key: `u${share.from}`,
      lat: share.lat,
      lng: share.lng,
      color: COLORS[share.from_role] || COLORS.seeker,
      label: `${share.from_name} (${share.from_role})`,
    }));
  }, [list]);

  return (
    <div className="stack">
      <Feedback error={error} />
      {loading && !data && <Loading />}

      <section className="panel">
        <h2>Live locations</h2>
        <p className="quote">
          People appear here only while they have chosen to share their location with someone they work with. Sharing stops by itself after two hours.
          Use this to help in an emergency or a dispute.
        </p>
        <div className="admin-map">
          <LiveMap points={points} />
        </div>
        <div className="cal-legend">
          <span><i className="dot" style={{ background: COLORS.seeker }} /> Seeker</span>
          <span><i className="dot" style={{ background: COLORS.provider }} /> Provider</span>
        </div>
      </section>

      {!loading && list.length === 0 && (
        <Empty title="Nobody is sharing right now" text="When a seeker or provider shares their location, they show up here live." />
      )}

      {list.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sharing</th>
                <th>With</th>
                <th>Updated</th>
                <th>Map</th>
              </tr>
            </thead>
            <tbody>
              {list.map((share) => (
                <tr key={`${share.from}:${share.to}`}>
                  <td>
                    <b>{share.from_name}</b>
                    <small>{share.from_role}</small>
                  </td>
                  <td>{share.to_name}</td>
                  <td>
                    {ago(share.updated_at, now)}
                    {share.accuracy ? <small>±{Math.round(share.accuracy)} m</small> : null}
                  </td>
                  <td>
                    {share.lat != null ? (
                      <a href={`https://www.google.com/maps?q=${share.lat},${share.lng}`} target="_blank" rel="noreferrer">Open in Maps ↗</a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AvailableProviders />
    </div>
  );
}
