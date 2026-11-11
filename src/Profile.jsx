import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDate } from './api.js';
import { useAuth } from './auth.jsx';
import NotificationPreferences from './NotificationPreferences.jsx';
import PaymentSettings from './PaymentSettings.jsx';
import ProfilePhoto from './ProfilePhoto.jsx';
import { Avatar, Feedback, Loading, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';

const KYC_HELP = {
  none: 'Verify your identity (NID, or birth certificate if you are under 18) to earn a verified badge and build trust.',
  pending: 'Your documents are under review. We will notify you soon.',
  verified: 'Your identity is verified. Others see a verified badge on your profile.',
  rejected: 'Your last submission was rejected. Open verification to fix it and try again.',
};

export default function Profile() {
  const { user, updateUser, login } = useAuth();
  const navigate = useNavigate();

  const { data: me, loading, error: loadError, reload } = useLoad(async () => (await apiFetch('/me')).user);

  const [form, setForm] = useState(null);
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' });

  const profile = useActions(reload);
  const security = useActions();
  const roleAction = useActions();

  useEffect(() => {
    if (me) {
      setForm({
        full_name: me.full_name,
        phone: me.phone,
        bio: me.bio,
        phone_visible: me.phone_visible,
      });
    }
  }, [me]);

  if (loading && !me) return <div className="pg pg-narrow"><Loading /></div>;
  if (!me || !form) {
    return (
      <div className="pg pg-narrow">
        <Feedback error={loadError} />
      </div>
    );
  }

  async function saveProfile(event) {
    event.preventDefault();

    const ok = await profile.run(async () => {
      const data = await apiFetch('/me', { method: 'PUT', body: form });
      updateUser(data.user);
      return data;
    });

    return ok;
  }

  async function changePassword(event) {
    event.preventDefault();
    security.setError('');

    if (passwords.new_password !== passwords.confirm) {
      security.setError('The new passwords do not match.');
      return;
    }

    const ok = await security.run(() =>
      apiFetch('/me/password', {
        method: 'PUT',
        body: {
          current_password: passwords.current_password,
          new_password: passwords.new_password,
        },
      })
    );

    if (ok) {
      setPasswords({ current_password: '', new_password: '', confirm: '' });
      reload(true);
    }
  }

  async function switchRole() {
    const next = user.role === 'seeker' ? 'provider' : 'seeker';
    if (!window.confirm(`Switch your account to ${next}?`)) return;

    const ok = await roleAction.run(async () => {
      const data = await apiFetch('/me/role', { method: 'PUT', body: { role: next } });
      login(data);
      return data;
    });

    if (ok) navigate('/');
  }

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="pg pg-narrow">
      <PageHead title="Profile and settings" subtitle="Manage how you appear to others and keep your account secure." />

      <div className="stack">
        <ProfilePhoto me={me} onChanged={reload} />

        <section className="panel">
          <div className="person" style={{ marginBottom: 18 }}>
            <Avatar name={me.full_name} imageId={me.avatar_image_id} />
            <div>
              <strong>{me.full_name}</strong>
              <small>
                {me.email} · Member since {formatDate(me.member_since)}
              </small>
            </div>
            <span style={{ marginLeft: 'auto' }} className="badge badge-info">
              {me.role}
            </span>
          </div>

          {me.role === 'provider' && (
            <p style={{ margin: '0 0 18px' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/providers/${me.id}`)}>
                My portfolio and public profile
              </button>
            </p>
          )}

          <Feedback error={profile.error} notice={profile.notice} />

          <form className="form" onSubmit={saveProfile}>
            <div className="form-row">
              <label className="field">
                <span>Full name</span>
                <input value={form.full_name} onChange={set('full_name')} maxLength={100} required />
              </label>
              <label className="field">
                <span>Phone</span>
                <input value={form.phone} onChange={set('phone')} maxLength={20} placeholder="01XXXXXXXXX" />
              </label>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={!!form.phone_visible}
                onChange={(event) => setForm((current) => ({ ...current, phone_visible: event.target.checked }))}
              />
              <span>
                <b>Show my phone number to people I work with</b>
                <small>Lets them call you directly from the chat. Off by default.</small>
              </span>
            </label>

            <label className="field">
              <span>Email</span>
              <input value={me.email} disabled />
            </label>

            <label className="field">
              <span>About you</span>
              <textarea
                value={form.bio}
                onChange={set('bio')}
                maxLength={500}
                placeholder="Tell people about your experience or what you need help with."
              />
              <small>{form.bio.length}/500</small>
            </label>

            <div>
              <button className="btn" disabled={profile.busy}>
                {profile.busy ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="card-row">
            <h2>Identity verification (KYC)</h2>
            <StatusBadge status={me.kyc_status === 'none' ? 'inactive' : me.kyc_status} />
          </div>
          <p className="sub">{KYC_HELP[me.kyc_status] || KYC_HELP.none}</p>
          <button className="btn btn-ghost" onClick={() => navigate('/kyc')}>
            {me.kyc_status === 'verified' ? 'View verification' : me.kyc_status === 'pending' ? 'View submission' : 'Verify my identity'}
          </button>
        </section>

        <NotificationPreferences me={me} onSaved={reload} />

        {user.role === 'provider' && <PaymentSettings />}

        <section className="panel">
          <h2>Password</h2>
          <p className="sub">
            {me.has_password
              ? 'Use a strong password of at least 8 characters.'
              : 'Your account uses Google sign-in. Set a password to also log in with your email.'}
          </p>

          <Feedback error={security.error} notice={security.notice} />

          <form className="form" onSubmit={changePassword}>
            {me.has_password && (
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={passwords.current_password}
                  onChange={(event) =>
                    setPasswords({ ...passwords, current_password: event.target.value })
                  }
                  required
                />
              </label>
            )}

            <div className="form-row">
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={passwords.new_password}
                  onChange={(event) => setPasswords({ ...passwords, new_password: event.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={passwords.confirm}
                  onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                  required
                />
              </label>
            </div>

            <div>
              <button className="btn" disabled={security.busy}>
                {security.busy ? 'Updating...' : 'Update password'}
              </button>
            </div>
          </form>
        </section>

        {user.role !== 'admin' && (
          <section className="panel">
            <h2>Account type</h2>
            <p className="sub">
              You are a <b>{user.role}</b>. You can switch only before posting work, applying, listing a
              service or booking.
            </p>
            <Feedback error={roleAction.error} />
            <button className="btn btn-ghost" onClick={switchRole} disabled={roleAction.busy}>
              Switch to {user.role === 'seeker' ? 'provider' : 'seeker'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
