import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from './api.js';
import Icon from './Icon.jsx';

const SEND_EVERY_MS = 6000;

/** The ambulance driver's page. No login: the secret link from the admin is the key. Keep it open to share the position. */
export default function DriverTrack() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [last, setLast] = useState(null);
  const watchRef = useRef(null);
  const lastSentRef = useRef(0);
  const wakeRef = useRef(null);

  useEffect(() => {
    apiFetch(`/ambulance-track/${encodeURIComponent(token)}`, { auth: false })
      .then((r) => setInfo(r.ambulance))
      .catch((e) => setError(e.message));
  }, [token]);

  const stop = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
    setSharing(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setError('');
    if (!navigator.geolocation) {
      setError('This phone cannot share its location.');
      return;
    }
    setSharing(true);
    try {
      wakeRef.current = (await navigator.wakeLock?.request('screen')) || null; // keep the screen on so sharing continues
    } catch {
      wakeRef.current = null;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastSentRef.current < SEND_EVERY_MS) return;
        lastSentRef.current = now;
        try {
          await apiFetch(`/ambulance-track/${encodeURIComponent(token)}`, { method: 'POST', auth: false, body: { lat: position.coords.latitude, lng: position.coords.longitude } });
          setLast(new Date());
        } catch (err) {
          setError(err.message);
        }
      },
      (err) => {
        setError(err.code === 1 ? 'Location is blocked. Allow location for this page in the browser settings.' : 'Could not get the location. Check that GPS is on.');
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  return (
    <main className="driver">
      <div className="driver-card">
        <span className="driver-ico" aria-hidden="true"><Icon name="ambulance" size="1.8em" /></span>
        <h1>{info ? info.name : 'Ambulance'}</h1>
        {info && <p>{info.driver_name}{info.vehicle_no ? ` · ${info.vehicle_no}` : ''}</p>}

        {error && <p className="driver-error" role="alert">{error}</p>}

        {info && (
          <>
            <button className={`btn driver-btn ${sharing ? 'btn-ghost' : ''}`} onClick={sharing ? stop : start}>
              {sharing ? 'Stop sharing' : 'Start sharing my location'}
            </button>
            <p className="hint">
              {sharing
                ? last
                  ? `Sharing live. Last sent ${last.toLocaleTimeString()}. Keep this page open.`
                  : 'Getting your position...'
                : 'Press the button while you drive. The person waiting for the ambulance sees it on a map.'}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
