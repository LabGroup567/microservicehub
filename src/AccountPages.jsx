import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from './api.js';
import { LogoMark } from './Logo.jsx';
import { Feedback, Loading, useActions } from './ui.jsx';
import './ui.css';

function Shell({ title, subtitle, children }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link to="/login" className="auth-brand">
          <LogoMark size={40} />
          <span>
            MicroService<b>Hub</b>
          </span>
        </Link>
        <h1>{title}</h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
      </section>
    </main>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useActions();

  async function submit(event) {
    event.preventDefault();
    const ok = await run(() => apiFetch('/forgot-password', { method: 'POST', auth: false, body: { email } }));
    if (ok) setSent(true);
  }

  return (
    <Shell title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      {sent ? (
        <>
          <div className="alert alert-ok">
            If <b>{email}</b> is registered, a reset link is on its way. It works for one hour. Check your spam folder too.
          </div>
          <Link className="btn btn-block" to="/login">
            Back to login
          </Link>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <Feedback error={error} />
          <label className="field">
            <span>Email address</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required />
          </label>
          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Sending...' : 'Send reset link'}
          </button>
          <Link className="auth-link" to="/login">
            Back to login
          </Link>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run, setError } = useActions();

  async function submit(event) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    const ok = await run(() => apiFetch('/reset-password', { method: 'POST', auth: false, body: { token, password } }));
    if (ok) setDone(true);
  }

  if (!token) {
    return (
      <Shell title="Link not valid" subtitle="This reset link is incomplete. Request a new one.">
        <Link className="btn btn-block" to="/forgot-password">
          Request a new link
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password" subtitle="Use at least 8 characters.">
      {done ? (
        <>
          <div className="alert alert-ok">Your password was updated. You can log in with it now.</div>
          <button className="btn btn-block" onClick={() => navigate('/login', { replace: true })}>
            Go to login
          </button>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <Feedback error={error} />
          <label className="field">
            <span>New password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={8} autoComplete="new-password" required />
          </label>
          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Saving...' : 'Update password'}
          </button>
          <Link className="auth-link" to="/forgot-password">
            Link expired? Request a new one
          </Link>
        </form>
      )}
    </Shell>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ loading: true, ok: false, message: '' });

  useEffect(() => {
    if (!token) {
      setState({ loading: false, ok: false, message: 'This verification link is incomplete.' });
      return undefined;
    }

    let cancelled = false;
    apiFetch('/verify-email', { method: 'POST', auth: false, body: { token } })
      .then((data) => !cancelled && setState({ loading: false, ok: true, message: data.message }))
      .catch((error) => !cancelled && setState({ loading: false, ok: false, message: error.message }));

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Shell title="Email verification">
      {state.loading && <Loading text="Verifying..." />}
      {!state.loading && <div className={`alert ${state.ok ? 'alert-ok' : ''}`}>{state.message}</div>}
      {!state.loading && (
        <Link className="btn btn-block" to="/">
          {state.ok ? 'Continue to MicroServiceHub' : 'Back to home'}
        </Link>
      )}
    </Shell>
  );
}
