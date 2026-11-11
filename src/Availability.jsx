import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { useAuth } from './auth.jsx';
import Calendar from './Calendar.jsx';
import { Feedback, useActions, useLoad } from './ui.jsx';

/** Providers mark the days they cannot work. Seekers cannot book those days. */
export default function Availability() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState([]);
  const { data, loading, error, reload } = useLoad(() => apiFetch(`/availability/${user.id}`), [user.id]);
  const actions = useActions(reload);

  useEffect(() => {
    if (data) setDays(data.days_off);
  }, [data]);

  const toggle = (day) => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort()));
  const dirty = data && JSON.stringify([...days].sort()) !== JSON.stringify(data.days_off);

  return (
    <section className="panel availability">
      <div className="card-row">
        <div>
          <h2>My availability</h2>
          <p className="quote">Tap the days you cannot work. Customers will not be able to book them.</p>
        </div>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Hide calendar' : `Edit calendar${data?.days_off.length ? ` (${data.days_off.length} days off)` : ''}`}
        </button>
      </div>

      {open && (
        <>
          <Feedback error={error || actions.error} notice={actions.notice} />
          {loading && !data ? (
            <p className="quote">Loading...</p>
          ) : (
            <>
              <Calendar daysOff={days} booked={data?.booked || []} onToggle={toggle} />
              <div className="card-actions">
                <button
                  className="btn btn-sm"
                  disabled={!dirty || actions.busy}
                  onClick={() => actions.run(() => apiFetch('/my-availability', { method: 'PUT', body: { days } }))}
                >
                  {actions.busy ? 'Saving...' : 'Save availability'}
                </button>
                {days.length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setDays([])}>Clear all days off</button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
