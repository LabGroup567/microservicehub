import { turnOffPresence, turnOnPresence, usePresence } from './presence.js';

/** A provider's switch: "Available now" shows an approximate spot on the seekers' map. */
export default function AvailableNow() {
  const { on, busy, error } = usePresence();

  return (
    <section className="avail-card" aria-label="Available now">
      <div className="avail-text">
        <span className={`avail-dot ${on ? 'on' : ''}`} aria-hidden="true" />
        <div>
          <strong>{on ? 'You are available now' : 'Show that you are available now'}</strong>
          <p>
            {on
              ? 'Seekers can see you on the map. Keep this app open to show as "Active now". If you close it, you stay on the map as "last seen" for up to 3 hours.'
              : 'Seekers can find you on a map while you are free. Only an approximate spot (about 500 m) is shown, never your exact address.'}
          </p>
          {error && <p className="field-error">{error}</p>}
        </div>
      </div>

      <button
        type="button"
        className={`btn ${on ? 'btn-ghost' : ''}`}
        disabled={busy}
        onClick={on ? turnOffPresence : turnOnPresence}
      >
        {busy ? 'Please wait...' : on ? 'Go offline' : 'Go available'}
      </button>
    </section>
  );
}
