import { useMemo, useState } from 'react';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n) => String(n).padStart(2, '0');
export const toDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * A month grid. Days off are red, busy days (accepted bookings) are amber.
 * Pass `onPick` to choose a date (booking) or `onToggle` to mark days off (provider).
 */
export default function Calendar({ daysOff = [], booked = [], selected = '', onPick, onToggle }) {
  const today = toDay(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const off = useMemo(() => new Set(daysOff), [daysOff]);
  const busy = useMemo(() => new Set(booked), [booked]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: total }, (_, index) => index + 1)];
  }, [month]);

  const atStart = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  function click(day) {
    if (day < today) return;
    if (onToggle) onToggle(day);
    else if (onPick && !off.has(day)) onPick(day);
  }

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="btn btn-ghost btn-sm" disabled={atStart} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          ‹
        </button>
        <b>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="cal-grid">
        {WEEK.map((name) => (
          <span className="cal-dow" key={name}>{name}</span>
        ))}

        {cells.map((day, index) => {
          if (!day) return <span key={`gap-${index}`} />;

          const key = `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}`;
          const past = key < today;
          const classes = [
            'cal-day',
            past && 'is-past',
            off.has(key) && 'is-off',
            busy.has(key) && !off.has(key) && 'is-busy',
            key === selected && 'is-selected',
            key === today && 'is-today',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={key}
              type="button"
              className={classes}
              disabled={past || (!onToggle && off.has(key))}
              onClick={() => click(key)}
              aria-pressed={onToggle ? off.has(key) : key === selected}
              title={off.has(key) ? 'Not available' : busy.has(key) ? 'Already has a booking' : 'Available'}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="dot dot-free" /> Available</span>
        <span><i className="dot dot-off" /> Not available</span>
        <span><i className="dot dot-busy" /> Has a booking</span>
      </div>
    </div>
  );
}
