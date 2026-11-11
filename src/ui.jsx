import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, imageUrl } from './api.js';
import Icon from './Icon.jsx';

/** Loads data on mount (and whenever deps change). */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: '' }));

    try {
      const data = await loaderRef.current();
      setState({ data, loading: false, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload };
}

/** Returns `value` after it stops changing for `delay` ms. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/** Runs a button action, tracks busy/error/success and refreshes afterwards. */
export function useActions(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = useCallback(
    async (action, okMessage) => {
      setBusy(true);
      setError('');
      setNotice('');

      try {
        const result = await action();
        setNotice(okMessage || result?.message || 'Done.');
        if (onDone) await onDone();
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onDone]
  );

  return { busy, error, notice, run, setError, setNotice };
}

export function Feedback({ error, notice }) {
  return (
    <>
      {error && (
        <div className="alert" role="alert">
          <span className="alert-icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-ok" role="status">
          <span className="alert-icon" aria-hidden="true"><Icon name="check" /></span>
          <span>{notice}</span>
        </div>
      )}
    </>
  );
}

export function Loading({ text = 'Loading...', variant = 'lines' }) {
  if (variant === 'cards') {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{text}</span>
        <div className="grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="card skeleton-card" key={i}>
              <span className="skeleton skeleton-pic" />
              <span className="skeleton" style={{ width: '40%' }} />
              <span className="skeleton skeleton-title" />
              <span className="skeleton" />
              <span className="skeleton" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="sr-only">{text}</span>
      <div className="skeleton-stack" aria-hidden="true">
        <span className="skeleton" style={{ width: '38%' }} />
        <span className="skeleton" />
        <span className="skeleton" style={{ width: '82%' }} />
        <span className="skeleton" style={{ width: '56%' }} />
      </div>
    </div>
  );
}

/** A row of real numbers. Zeros are left out, so a young site never advertises "0 jobs". */
export function PulseStrip({ stats }) {
  if (!stats) return null;
  const items = [
    [stats.open_work, 'Open jobs now'],
    [stats.service_types, 'Service types'],
    [stats.verified_providers, 'Verified providers'],
    [stats.completed_jobs, 'Jobs completed'],
  ].filter(([value]) => Number(value) > 0);
  if (items.length < 2) return null;

  return (
    <section className="mh-pulse" aria-label="The marketplace right now" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(([value, label]) => (
        <div key={label}>
          <strong>{Number(value).toLocaleString('en-US')}</strong>
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}

/** A calm picture for pages with nothing on them yet: a tray, a magnifier and a few sparkles. */
function EmptyArt() {
  return (
    <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="#e6f2ea" />
      <path d="M26 66h20l5 8h18l5-8h20v20a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V66z" fill="#fff" stroke="#9cc9b0" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M30 66l8-22a6 6 0 0 1 5.6-4h32.8a6 6 0 0 1 5.6 4l8 22" fill="#f4faf6" stroke="#9cc9b0" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="82" cy="36" r="10" fill="#fff" stroke="#1b704a" strokeWidth="3" />
      <path d="M89.5 43.5L97 51" stroke="#1b704a" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M24 38l2.2 5 5 2.2-5 2.2-2.2 5-2.2-5-5-2.2 5-2.2z" fill="#e7cc8d" />
      <path d="M100 76l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="#e7cc8d" />
    </svg>
  );
}

export function Empty({ title, text, action, icon }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        {icon ? <span className="empty-emoji">{icon}</span> : <EmptyArt />}
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

const TONES = {
  open: 'info',
  assigned: 'warn',
  in_progress: 'warn',
  pending: 'warn',
  accepted: '',
  completed: '',
  active: '',
  verified: '',
  rejected: 'danger',
  cancelled: 'danger',
  inactive: 'muted',
  hidden: 'danger',
  resolved: '',
  dismissed: 'muted',
};

export function StatusBadge({ status }) {
  const tone = TONES[status] ?? 'muted';
  return (
    <span className={`badge ${tone ? `badge-${tone}` : ''}`}>
      {String(status || '').replace('_', ' ')}
    </span>
  );
}

export function Stars({ value, count }) {
  const rating = Math.round(Number(value) || 0);

  if (!count) return <span className="badge badge-muted">No reviews yet</span>;

  return (
    <span title={`${value} out of 5`}>
      <span className="stars">
        {Array.from({ length: rating }, (_, i) => <Icon key={i} name="star" filled />)}
        <span className="off">{Array.from({ length: 5 - rating }, (_, i) => <Icon key={i} name="star" filled />)}</span>
      </span>{' '}
      <small>
        {Number(value).toFixed(1)} ({count})
      </small>
    </span>
  );
}

export function StarInput({ value, onChange }) {
  return (
    <div className="star-input" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={star <= value ? 'on' : ''}
          onClick={() => onChange(star)}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          aria-checked={star === value}
          role="radio"
        >
          <Icon name="star" filled />
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, imageId }) {
  const [broken, setBroken] = useState(false);

  if (imageId && !broken) {
    return <img className="avatar avatar-img" src={imageUrl(imageId)} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className="avatar">{(name || '?').charAt(0).toUpperCase()}</span>;
}

export function Modal({ title, subtitle, onClose, children }) {
  const box = useRef(null);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The page behind a dialog should not scroll, and focus goes back to the button that opened it.
  useEffect(() => {
    const opener = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.querySelector('input, textarea, select')?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previous;
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal-bg" onClick={onClose}>
      <section
        ref={box}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="pg-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="pg-actions">{children}</div>}
    </div>
  );
}

/** Opens the in-app report dialog for a user, work post or listing. */
export function ReportButton({ type, id, onReport, label = 'Report' }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => onReport({ type, id })}
    >
      <Icon name="flag" /> {label}
    </button>
  );
}

export function ReportDialog({ report, onClose }) {
  const [reason, setReason] = useState('');
  const { busy, error, notice, run } = useActions();
  const [sent, setSent] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const ok = await run(
      () =>
        apiFetch('/reports', {
          method: 'POST',
          body: { target_type: report.type, target_id: report.id, reason },
        }),
      'Report submitted. Thank you.'
    );
    if (ok) setSent(true);
  }

  const noun = { user: 'user', work: 'work post', listing: 'service listing' }[report.type];

  return (
    <Modal title={`Report this ${noun}`} subtitle="Tell us what is wrong. A moderator will review it." onClose={onClose}>
      <Feedback error={error} notice={notice} />
      {!sent && (
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>What is the problem?</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={5}
              maxLength={500}
              required
              placeholder="e.g. fake request, abusive messages, scam"
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={busy}>
              {busy ? 'Sending...' : 'Submit report'}
            </button>
          </div>
        </form>
      )}
      {sent && (
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
}
