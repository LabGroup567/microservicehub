import { useRef, useState } from 'react';
import { API, imageUrl, readSession } from './api.js';
import Icon from './Icon.jsx';

const MAX_BYTES = 2 * 1024 * 1024;

/** Shrinks big camera photos to a JPEG of at most 1400px so uploads are fast on mobile data. */
async function shrinkPhoto(file, maxSide = 1400, quality = 0.82) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 600 * 1024) {
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

/** Shrinks and uploads one photo, and returns its id. Throws an Error with a friendly message. */
export async function uploadPhoto(original) {
  if (!/^image\/(jpeg|png|webp)$/.test(original.type)) throw new Error('Choose a JPG, PNG or WebP photo.');

  const file = await shrinkPhoto(original);
  if (file.size > MAX_BYTES) throw new Error('This photo is too large. Try a smaller one.');

  const body = new FormData();
  body.set('image', file);
  const response = await fetch(`${API}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readSession()?.token}` },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || 'Could not upload the photo.');
  return data.image_id;
}

/** A photo (or a neat placeholder) for a card. */
export function Thumb({ imageId, label = '', className = '' }) {
  const [broken, setBroken] = useState(false);

  if (!imageId || broken) return null;

  return (
    <img
      className={`thumb ${className}`}
      src={imageUrl(imageId)}
      alt={label}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/** Choose, shrink and upload one photo. `value` is the image id; onChange gets the new id or null. */
export function PhotoField({ value, onChange, label = 'Photo (optional)' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(event) {
    const original = event.target.files?.[0];
    event.target.value = '';
    if (!original) return;

    setError('');
    if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
      setError('Choose a JPG, PNG or WebP photo.');
      return;
    }

    setBusy(true);
    try {
      const file = await shrinkPhoto(original);
      if (file.size > MAX_BYTES) throw new Error('This photo is too large. Try a smaller one.');

      const body = new FormData();
      body.set('image', file);
      const response = await fetch(`${API}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${readSession()?.token}` },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not upload the photo.');

      onChange(data.image_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field photo-field">
      <span>{label}</span>
      <div className="photo-row">
        {value ? (
          <Thumb imageId={value} label="Selected photo" className="thumb-preview" />
        ) : (
          <div className="thumb-empty" aria-hidden="true"><Icon name="camera" /></div>
        )}

        <div className="photo-buttons">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} hidden />
          <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading...' : value ? 'Change photo' : 'Add photo'}
          </button>
          {value && !busy && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
