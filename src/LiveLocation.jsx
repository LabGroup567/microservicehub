import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api.js';
import LiveMap from './LiveMap.jsx';
import { useRealtime } from './realtime.jsx';
import { Modal } from './ui.jsx';
import Icon from './Icon.jsx';

function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function ago(timestamp, now) {
  if (!timestamp) return 'waiting for first update';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

/** Share and view live location with one chat partner. */
export default function LiveLocation({ peer }) {
  const { socket, sharingTo, myPosition, geoError, startSharing, stopSharing } = useRealtime();

  const [theirs, setTheirs] = useState({ active: false });
  const [serverMine, setServerMine] = useState({ active: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const sharing = sharingTo.includes(peer.id);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/location/${peer.id}`);
      setTheirs(data.peer);
      setServerMine(data.mine);
    } catch {
      // Location is optional; chat keeps working without it.
    }
  }, [peer.id]);

  useEffect(() => {
    setTheirs({ active: false });
    setServerMine({ active: false });
    setError('');
    load();
  }, [load]);

  // Live updates from the other person.
  useEffect(() => {
    if (!socket) return undefined;

    const onUpdate = (data) => {
      if (data.from === peer.id) setTheirs(data);
    };
    const onStatus = (data) => {
      if (data.from !== peer.id) return;
      setTheirs(data.active ? data : { active: false });
    };

    socket.on('location:update', onUpdate);
    socket.on('location:status', onStatus);

    return () => {
      socket.off('location:update', onUpdate);
      socket.off('location:status', onStatus);
    };
  }, [socket, peer.id]);

  // Keeps the "x seconds ago" label fresh.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function start() {
    if (
      !window.confirm(
        `Share your live location with ${peer.full_name}? They will see where you are for up to 2 hours. You can stop any time.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    const result = await startSharing(peer.id);
    if (!result.ok) setError(result.message || 'Could not start sharing.');
    await load();
    setBusy(false);
  }

  async function stop() {
    stopSharing(peer.id);
    setServerMine({ active: false });
  }

  const points = useMemo(() => {
    const list = [];
    if (theirs.active && theirs.lat != null) {
      list.push({ key: 'peer', lat: theirs.lat, lng: theirs.lng, label: peer.full_name });
    }
    if (sharing && myPosition) {
      list.push({ key: 'me', lat: myPosition.lat, lng: myPosition.lng, label: 'You' });
    }
    return list;
  }, [theirs, sharing, myPosition, peer.full_name]);

  const showPanel = theirs.active || sharing || serverMine.active;
  const distance =
    points.length === 2 ? distanceKm(points[0], points[1]) : null;
  const paused = serverMine.active && !sharing;

  return (
    <div className="loc">
      <div className="loc-bar">
        {theirs.active ? (
          <span className="loc-live">
            <i /> {peer.full_name} is sharing live location
          </span>
        ) : (
          <span className="loc-muted">Live location is off</span>
        )}

        {sharing ? (
          <button className="btn btn-danger btn-sm" onClick={stop}>
            ⏹ Stop sharing
          </button>
        ) : (
          <button className="btn btn-soft btn-sm" onClick={start} disabled={busy}>
            <Icon name="pin" /> {paused ? 'Resume sharing' : 'Share my location'}
          </button>
        )}
      </div>

      {(error || geoError) && <div className="alert" style={{ margin: '8px 0 0' }}>{error || geoError}</div>}

      {showPanel && (
        <div className="loc-panel">
          {points.length > 0 ? (
            <LiveMap points={points} />
          ) : (
            <div className="loc-wait">
              {sharing
                ? 'Getting your position...'
                : theirs.active
                  ? `Waiting for ${peer.full_name}'s first position...`
                  : paused
                    ? 'Sharing is paused on this device. Tap Resume to continue.'
                    : ''}
            </div>
          )}

          <div className="loc-meta">
            {theirs.active && theirs.lat != null && (
              <span>
                {peer.full_name}: updated {ago(theirs.updated_at, now)}
                {theirs.accuracy ? ` · ±${Math.round(theirs.accuracy)} m` : ''}
              </span>
            )}
            {distance != null && (
              <span>
                Distance: <b>{distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`}</b>
              </span>
            )}
            {theirs.active && theirs.lat != null && (
              <a
                href={`https://www.google.com/maps?q=${theirs.lat},${theirs.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps ↗
              </a>
            )}
            {sharing && <span>You are sharing with {peer.full_name}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Opens live location (view and share) with one person in a dialog. */
export function LocationButton({ peer, label = <><Icon name="pin" /> Live location</> }) {
  const [open, setOpen] = useState(false);
  const { sharingTo } = useRealtime();
  const sharing = sharingTo.includes(peer.id);

  return (
    <>
      <button className="btn btn-soft btn-sm" onClick={() => setOpen(true)}>
        {sharing ? <><Icon name="pin" /> Sharing...</> : label}
      </button>

      {open && (
        <Modal
          title={`Live location · ${peer.full_name}`}
          subtitle="See where they are, and share where you are, while the job is on."
          onClose={() => setOpen(false)}
        >
          <LiveLocation peer={peer} />
        </Modal>
      )}
    </>
  );
}
