import { useEffect, useState } from 'react';
import { API, apiFetch, formatDate, readSession } from './api.js';
import { useAuth } from './auth.jsx';
import { Feedback, Loading, Modal, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

// 18 and over verify with a National ID. Under 18 verify with a birth certificate.
const DOCS_BY_METHOD = {
  nid: [
    ['nid_front', 'NID front side', 'Clear photo of the front of your NID card.'],
    ['nid_back', 'NID back side', 'Clear photo of the back of your NID card.'],
    ['selfie', 'Selfie with NID', 'Your face next to your NID card, in good light.'],
  ],
  birth_certificate: [
    ['birth_certificate', 'Birth certificate', 'Clear photo of the whole page, with your name and birth date readable.'],
    ['selfie', 'Selfie with certificate', 'Your face next to your birth certificate, in good light.'],
  ],
};

const MIN_AGE = 13;

/** Whole years since a YYYY-MM-DD date (null when the date is empty or invalid). */
function ageOf(dob) {
  const born = new Date(`${dob}T00:00:00`);
  if (!dob || Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age -= 1;
  return age;
}

/** Resizes big camera photos to a JPEG of at most 1600px, so uploads are fast on mobile data. */
async function shrinkImage(file, maxSide = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 900 * 1024) {
    bitmap.close?.();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' });
}

/** Fetches a protected KYC photo (needs the login token) and shows it. */
export function KycDocument({ userId, type, label }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;

    fetch(`${API}/kyc/file/${userId}/${type}`, {
      headers: { Authorization: `Bearer ${readSession()?.token}` },
    })
      .then((response) => (response.ok ? response.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, type]);

  return (
    <div className="kyc-doc">
      {url ? (
        <img src={url} alt={label} onClick={() => setZoom(true)} />
      ) : (
        <div className="kyc-empty">{failed ? 'Not uploaded' : 'Loading...'}</div>
      )}
      {label}

      {zoom && (
        <Modal title={label} onClose={() => setZoom(false)}>
          <img src={url} alt={label} style={{ width: '100%', borderRadius: 10 }} />
        </Modal>
      )}
    </div>
  );
}

export default function Kyc() {
  const { user, updateUser } = useAuth();
  const { data: kyc, loading, error, reload } = useLoad(async () => (await apiFetch('/kyc/me')).kyc);
  const actions = useActions(reload);

  const [form, setForm] = useState({ full_name: '', id_number: '', dob: '' });
  const [files, setFiles] = useState({});
  const [previews, setPreviews] = useState({});

  useEffect(() => {
    if (kyc) {
      setForm({ full_name: kyc.full_name, id_number: kyc.method === 'birth_certificate' ? kyc.birth_cert_number : kyc.nid_number, dob: kyc.dob });
      updateUser({ kyc_status: kyc.status, nid_status: kyc.nid_status });
    }
  }, [kyc, updateUser]);

  useEffect(() => {
    const urls = Object.fromEntries(Object.entries(files).map(([type, file]) => [type, URL.createObjectURL(file)]));
    setPreviews(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  if (loading && !kyc) return <div className="pg pg-narrow"><Loading /></div>;
  if (!kyc) return <div className="pg pg-narrow"><Feedback error={error} /></div>;

  const canSubmit = kyc.status === 'none' || kyc.status === 'rejected';

  // The date of birth decides the route: a birth certificate under 18, an NID from 18.
  const age = ageOf(form.dob);
  const method = age !== null && age < 18 ? 'birth_certificate' : 'nid';
  const docs = DOCS_BY_METHOD[method];
  const idLabel = method === 'nid' ? 'NID number' : 'Birth registration number';
  const tooYoung = age !== null && age < MIN_AGE;

  function pick(type) {
    return async (event) => {
      const original = event.target.files?.[0];
      event.target.value = '';
      if (!original) return;

      if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
        actions.setError('Photos must be JPG, PNG or WebP images.');
        return;
      }
      if (original.size > 15 * 1024 * 1024) {
        actions.setError('This photo is too large. Choose one under 15 MB.');
        return;
      }

      const file = await shrinkImage(original);
      if (file.size > 3 * 1024 * 1024) {
        actions.setError('This photo is still too large after resizing. Try a smaller photo.');
        return;
      }

      actions.setError('');
      setFiles((current) => ({ ...current, [type]: file }));
    };
  }

  async function submit(event) {
    event.preventDefault();

    if (tooYoung) {
      actions.setError(`You must be at least ${MIN_AGE} years old to use MicroServiceHub.`);
      return;
    }

    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => body.set(key, value));
    body.set('method', method);
    // Only the photos that belong to this route are sent.
    docs.forEach(([type]) => files[type] && body.set(type, files[type]));

    const ok = await actions.run(async () => {
      const response = await fetch(`${API}/kyc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${readSession()?.token}` },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not submit verification.');
      return data;
    });

    if (ok) setFiles({});
  }

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="pg pg-narrow">
      <PageHead title="Identity verification" subtitle="Verify with your NID (18 and over) or your birth certificate (under 18). Only you and our admins can see your documents.">
        <StatusBadge status={kyc.status === 'none' ? 'inactive' : kyc.status} />
      </PageHead>

      <Feedback error={actions.error || error} notice={actions.notice} />

      {kyc.status === 'verified' && (
        <div className="alert alert-ok">Your identity is verified. A verified badge shows on your profile and applications.</div>
      )}
      {kyc.status === 'pending' && (
        <div className="alert alert-ok">
          Submitted {formatDate(kyc.submitted_at)}. An admin is reviewing your documents.
        </div>
      )}
      {kyc.status === 'rejected' && (
        <div className="alert">
          Your last submission was rejected: {kyc.reason || 'please upload clearer photos.'} Fix it below and submit again.
        </div>
      )}

      {!canSubmit && (
        <section className="panel">
          <h2>Your submission</h2>
          <p className="sub">
            {kyc.full_name} · {kyc.method === 'birth_certificate' ? `Birth certificate ${kyc.birth_cert_number}` : `NID ${kyc.nid_number}`} · born {formatDate(kyc.dob)}
          </p>
          <div className="kyc-docs">
            {DOCS_BY_METHOD[kyc.method || 'nid'].map(([type, label]) => (
              <KycDocument key={type} userId={user.id} type={type} label={label} />
            ))}
          </div>
        </section>
      )}

      {canSubmit && (
        <section className="panel">
          <form className="form" onSubmit={submit}>
            <div className="form-row">
              <label className="field">
                <span>Full name (as on your {method === 'nid' ? 'NID' : 'birth certificate'})</span>
                <input value={form.full_name} onChange={set('full_name')} maxLength={100} required />
              </label>
              <label className="field">
                <span>Date of birth</span>
                <input type="date" value={form.dob} onChange={set('dob')} max={new Date().toISOString().slice(0, 10)} required />
              </label>
            </div>

            {form.dob && (
              <p className={`alert ${tooYoung ? '' : 'alert-ok'}`}>
                {tooYoung
                  ? `You must be at least ${MIN_AGE} years old to use MicroServiceHub.`
                  : method === 'birth_certificate'
                    ? 'You are under 18, so you verify with your birth certificate and a selfie.'
                    : 'You verify with your National ID (NID) and a selfie.'}
              </p>
            )}

            <label className="field">
              <span>{idLabel}</span>
              <input value={form.id_number} onChange={set('id_number')} inputMode="numeric" placeholder="10 to 17 digits" required />
            </label>

            <div className="kyc-docs">
              {docs.map(([type, label, hint]) => (
                <label className="upload" key={type}>
                  {previews[type] ? <img src={previews[type]} alt={label} /> : null}
                  <b>
                    {label}
                    {kyc.documents.includes(type) && !files[type] ? ' <Icon name="check" /> uploaded' : ''}
                  </b>
                  <small>{files[type] ? files[type].name : hint}</small>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick(type)} hidden />
                </label>
              ))}
            </div>

            <p className="quote">
              Photos must be JPG, PNG or WebP. Large phone photos are resized automatically. Your documents are stored privately and used only to verify your
              identity.
            </p>

            <div>
              <button className="btn" disabled={actions.busy}>
                {actions.busy ? 'Submitting...' : 'Submit for verification'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
