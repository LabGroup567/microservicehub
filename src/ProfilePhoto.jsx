import { useRef, useState } from 'react';
import { apiFetch, formatDate, imageUrl } from './api.js';
import { useAuth } from './auth.jsx';
import { uploadPhoto } from './Photos.jsx';
import defaultAvatar from './assets/default-avatar.svg';
import Icon from './Icon.jsx';

/** The grey silhouette shown until someone adds a photo. */
export function DefaultAvatar() {
  return <img className="pp-default" src={defaultAvatar} alt="No profile photo yet" />;
}

/** Big round profile photo with an upload button and two small info cards around it. */
export default function ProfilePhoto({ me, onChanged }) {
  const { updateUser } = useAuth();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [broken, setBroken] = useState(false);

  const verified = me.kyc_status === 'verified';
  const hasPhoto = !!me.avatar_image_id && !broken;

  async function save(imageId, message) {
    const data = await apiFetch('/me/avatar', { method: 'PUT', body: { image_id: imageId } });
    updateUser({ avatar_image_id: data.user.avatar_image_id });
    setBroken(false);
    setNotice(message);
    onChanged?.();
  }

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      await save(await uploadPhoto(file), 'Your profile photo is updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remove your profile photo?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await save(null, 'Your profile photo was removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel pp-card">
      <div className="pp-stage">
        <div className="pp-ring">
          <div className="pp-photo">
            {hasPhoto ? (
              <img src={imageUrl(me.avatar_image_id)} alt={`${me.full_name}'s profile photo`} onError={() => setBroken(true)} />
            ) : (
              <DefaultAvatar />
            )}
          </div>
        </div>

        <div className="pp-float pp-float-a">
          <div>
            <b>{me.full_name}</b>
            <small>
              {me.role === 'provider' ? 'Provider' : me.role === 'admin' ? 'Admin' : 'Seeker'} · since {formatDate(me.member_since)}
              </small>
          </div>
        </div>

        <div className="pp-float pp-float-b">
          <span className={`pp-star ${verified ? '' : 'off'}`} aria-hidden="true">{verified ? <Icon name="check" /> : <Icon name="star" filled />}</span>
          <div>
            <b>{verified ? 'ID verified' : 'Not verified yet'}</b>
            <small>{verified ? 'People can trust you.' : 'Verify to earn a badge.'}</small>
          </div>
        </div>
      </div>

      <div className="pp-actions">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} hidden />
        <button type="button" className="btn pp-upload" disabled={busy} onClick={() => input.current?.click()}>
          <span aria-hidden="true"><Icon name="camera" /></span> {busy ? 'Uploading...' : hasPhoto ? 'Change Your Photo' : 'Upload Your Photo'}
        </button>
        {hasPhoto && !busy && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
            Remove photo
          </button>
        )}
      </div>

      {error && <p className="field-error" style={{ textAlign: 'center' }}>{error}</p>}
      {notice && !error && <p className="hint" style={{ textAlign: 'center' }}>{notice}</p>}
      <p className="hint" style={{ textAlign: 'center' }}>JPG, PNG or WebP. A clear photo of your face works best.</p>
    </section>
  );
}
