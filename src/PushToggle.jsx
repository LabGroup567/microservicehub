import { useCallback, useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState } from './push.js';
import Icon from './Icon.jsx';

function usePushState() {
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(await getPushState().catch(() => 'unsupported'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      if (state === 'on') await disablePush();
      else await enablePush();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [state, refresh]);

  return { state, error, busy, toggle };
}

/** Button for the Notifications page. */
export function PushToggle() {
  const { state, error, busy, toggle } = usePushState();

  if (state === 'loading') return null;

  if (state === 'unsupported') {
    return (
      <span className="badge badge-muted" title="Needs a modern browser on HTTPS or localhost">
        Phone alerts unavailable here
      </span>
    );
  }

  return (
    <>
      <button className={`btn ${state === 'on' ? 'btn-ghost' : ''}`} disabled={busy || state === 'blocked'} onClick={toggle}>
        {state === 'on' ? <><Icon name="bell-off" /> Turn off phone alerts</> : <><Icon name="mobile" /> Turn on phone alerts</>}
      </button>
      {state === 'blocked' && (
        <span className="badge badge-danger">Blocked in browser settings</span>
      )}
      {error && <span className="badge badge-danger">{error}</span>}
    </>
  );
}

/** Dismissible prompt shown to providers so they never miss new work. */
export function PushBanner() {
  const { state, error, busy, toggle } = usePushState();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('microservicehub-push-dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (state !== 'off' || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem('microservicehub-push-dismissed', '1');
    } catch {
      // Not remembering the choice is harmless.
    }
  }

  return (
    <div className="push-banner" role="region" aria-label="Phone notifications">
      <span>
        <Icon name="mobile" /> <b>Never miss new work.</b> Get an instant alert on this device when a seeker posts a job.
        {error && <em> {error}</em>}
      </span>
      <div>
        <button className="btn btn-sm" disabled={busy} onClick={toggle}>
          Turn on alerts
        </button>
        <button className="btn btn-ghost btn-sm" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
