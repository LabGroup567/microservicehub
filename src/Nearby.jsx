import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from './api.js';
import LiveMap from './LiveMap.jsx';
import { Avatar, Empty, Feedback, Loading, PageHead, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const RADII = [5, 10, 25, 50, 100];

function since(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min ago`;
}

/** Providers who are available right now, on a map and in a list. */
export default function Nearby() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [category, setCategory] = useState(params.get('category_id') || '');
  const [radius, setRadius] = useState(25);
  const [here, setHere] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [tick, setTick] = useState(0);
  const [liveOnly, setLiveOnly] = useState(false);

  const { data: categories } = useLoad(async () => (await apiFetch('/categories', { auth: false })).categories);

  const { data, loading, error } = useLoad(() => {
    const query = new URLSearchParams();
    if (category) query.set('category_id', category);
    if (here) {
      query.set('lat', here.lat);
      query.set('lng', here.lng);
      query.set('radius_km', radius);
    }
    return apiFetch(`/nearby-providers?${query}`);
  }, [category, radius, here, tick]);

  // Who is available changes all the time, so look again every minute.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const locate = useCallback(() => {
    setLocError('');
    if (!navigator.geolocation) {
      setLocError('This device cannot share its location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setHere({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocError(
          err.code === 1
            ? 'Location is blocked. Allow location for this site in your browser settings to sort by distance.'
            : 'Your location could not be found. Check that location is on and try again.'
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
    );
  }, []);

  const providers = (data?.providers || []).filter((p) => !liveOnly || p.live);
  const points = [
    ...providers.map((p) => ({
      key: `p${p.id}`,
      lat: p.lat,
      lng: p.lng,
      label: p.live ? p.full_name : `${p.full_name} (last seen)`,
      color: p.live ? '#c2410c' : '#8a8f8c',
    })),
    ...(here ? [{ key: 'me', lat: here.lat, lng: here.lng, label: 'You', color: '#175cd3' }] : []),
  ];

  return (
    <div className="pg">
      <PageHead title="Providers near you" subtitle="Verified providers who said they are available. Orange means active now. Grey means last seen a while ago. Spots are approximate." />

      <div className="filters compact">
        <label className="field">
          <span>Service</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All services</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Within</span>
          <select value={radius} onChange={(event) => setRadius(Number(event.target.value))} disabled={!here}>
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
        </label>

        <button className="btn" onClick={locate} disabled={locating}>
          {locating ? 'Finding you...' : here ? <><Icon name="pin" /> Update my location</> : <><Icon name="pin" /> Use my location</>}
        </button>

        <label className="check-field">
          <input type="checkbox" checked={liveOnly} onChange={(event) => setLiveOnly(event.target.checked)} />
          <span>Active now only</span>
        </label>

        <button className="btn btn-ghost" onClick={() => setTick((n) => n + 1)}>
          ↻ Refresh
        </button>
      </div>

      <Feedback error={error || locError} />

      {loading && !data && <Loading text="Looking for providers..." variant="cards" />}

      {data && (
        <div className="nearby">
          <div className="nearby-map">
            {points.length > 0 ? (
              <LiveMap points={points} />
            ) : (
              <div className="nearby-map-empty">The map fills up as providers go available.</div>
            )}
          </div>

          <div className="nearby-list">
            <p className="sub" style={{ margin: '0 0 10px' }}>
              {providers.length
                ? `${providers.length} available${here ? ' near you' : ''}, ${here ? 'closest first' : 'most recent first'}`
                : ''}
            </p>

            {providers.length === 0 && (
              <Empty
                title="Nobody is on the map right now"
                text={
                  here
                    ? 'No verified providers have switched on Available now within this distance. Try a bigger distance or a different service.'
                    : 'Providers choose to appear here when they are free. Check again in a little while.'
                }
              />
            )}

            <div className="stack">
              {providers.map((p) => (
                <article className="card nearby-card" key={p.id}>
                  <div className="card-row">
                    <div className="person">
                      <Avatar name={p.full_name} imageId={p.avatar_image_id} />
                      <div>
                        <strong>{p.full_name}</strong>
                        <small>
                          {p.live ? <span className="live-pill">● Active now</span> : <span>Last seen {since(p.minutes_ago)}</span>}
                          {p.distance_km !== null && ` · ${p.distance_km} km away`}
                        </small>
                      </div>
                    </div>
                    <span className="badge"><Icon name="check" /> ID verified</span>
                  </div>

                  {p.categories.length > 0 && (
                    <div className="meta" style={{ marginTop: 8 }}>
                      {p.categories.map((name) => (
                        <span key={name} className="badge badge-muted">
                          {name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="card-actions">
                    <button className="btn btn-sm" onClick={() => navigate(`/providers/${p.id}`)}>
                      View profile
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages/${p.id}`)}>
                      <Icon name="chat" /> Message
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
