import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from './api.js';
import { Feedback, Loading, PageHead, useActions, useLoad } from './ui.jsx';
import { PhotoField } from './Photos.jsx';

const EMPTY = { title: '', category_id: '', description: '', location: '', budget: '', image_id: null };

export default function AddWork() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ ...EMPTY, category_id: params.get('category_id') || '' });
  const { busy, error, run } = useActions();

  const { data: categories, loading } = useLoad(async () => (await apiFetch('/categories')).categories);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();

    const ok = await run(() =>
      apiFetch('/services', {
        method: 'POST',
        body: { ...form, budget: Number(form.budget) },
      })
    );

    if (ok) navigate('/my-work', { state: { posted: true } });
  }

  return (
    <div className="pg pg-narrow">
      <PageHead
        title="Post your work"
        subtitle="Tell providers what you need. They will apply and you choose who to hire."
      />

      <section className="panel">
        <Feedback error={error} />
        {loading && <Loading />}

        {categories && (
          <form className="form" onSubmit={submit}>
            <label className="field">
              <span>Work title</span>
              <input value={form.title} onChange={set('title')} maxLength={150} placeholder="e.g. Need home cleaning" required />
            </label>

            <label className="field">
              <span>Category</span>
              <select value={form.category_id} onChange={set('category_id')} required>
                <option value="">Select a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={set('description')}
                placeholder="Describe the work, timing and anything the provider should know."
                required
              />
            </label>

            <div className="form-row">
              <label className="field">
                <span>Location</span>
                <input value={form.location} onChange={set('location')} maxLength={200} placeholder="e.g. Mirpur, Dhaka" required />
              </label>

              <label className="field">
                <span>Budget (BDT)</span>
                <input type="number" min="0" step="0.01" value={form.budget} onChange={set('budget')} placeholder="e.g. 800" required />
              </label>
            </div>

            <PhotoField value={form.image_id} onChange={(image_id) => setForm((current) => ({ ...current, image_id }))} label="Photo of the work (optional)" />

            <div className="pg-actions">
              <button className="btn" disabled={busy}>
                {busy ? 'Posting...' : 'Post work'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
