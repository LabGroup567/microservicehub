import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, closesIn, formatDate, formatMoney } from './api.js';
import { Empty, Feedback, Loading, Modal, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';
import { PhotoField, Thumb } from './Photos.jsx';
import Icon from './Icon.jsx';

const TABS = [
  ['all', 'All', () => true],
  ['open', 'Open', (w) => w.status === 'open'],
  ['active', 'In progress', (w) => ['assigned', 'in_progress'].includes(w.status)],
  ['completed', 'Completed', (w) => w.status === 'completed'],
  ['cancelled', 'Cancelled', (w) => w.status === 'cancelled'],
];

export default function MyWork() {
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab] = useState('all');
  const [editing, setEditing] = useState(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [work, cats] = await Promise.all([apiFetch('/my-work'), apiFetch('/categories')]);
    return { services: work.services, categories: cats.categories };
  });

  const actions = useActions(reload);

  const services = data?.services || [];
  const filter = TABS.find((t) => t[0] === tab)[2];
  const visible = services.filter(filter);

  async function saveEdit(event) {
    event.preventDefault();

    const ok = await actions.run(
      () =>
        apiFetch(`/my-work/${editing.id}`, {
          method: 'PUT',
          body: {
            category_id: Number(editing.category_id),
            title: editing.title,
            description: editing.description,
            location: editing.location,
            budget: Number(editing.budget),
            image_id: editing.image_id || null,
          },
        }),
      'Work updated successfully.'
    );

    if (ok) setEditing(null);
  }

  function cancelWork(work) {
    if (!window.confirm(`Cancel "${work.title}"? Providers will be notified.`)) return;
    actions.run(() => apiFetch(`/my-work/${work.id}/cancel`, { method: 'PATCH' }), 'Work cancelled.');
  }

  const set = (key) => (event) => setEditing((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="pg">
      <PageHead title="My posted work" subtitle="Review applications, hire a provider and track progress.">
        <button className="btn" onClick={() => navigate('/add-work')}>
          + Post new work
        </button>
      </PageHead>

      <Feedback
        error={error || actions.error}
        notice={actions.notice || (location.state?.posted ? 'Your work was posted. Providers can now apply.' : '')}
      />

      <div className="tabs">
        {TABS.map(([key, label, test]) => {
          const count = services.filter(test).length;
          return (
            <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
              {label} <span style={{ opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading && !data && <Loading text="Loading your work..." variant="cards" />}

      {data && visible.length === 0 && (
        <Empty
          title={services.length ? 'Nothing in this tab' : 'You have not posted any work yet'}
          text={services.length ? 'Try another filter.' : 'Post your first request and providers will apply.'}
          action={
            !services.length && (
              <button className="btn" onClick={() => navigate('/add-work')}>
                Post work
              </button>
            )
          }
        />
      )}

      <div className="grid">
        {visible.map((work) => (
          <article className="card clickable" key={work.id} onClick={() => navigate(`/work/${work.id}`)}>
            <Thumb imageId={work.image_id} label={work.title} />
            <div className="card-row">
              <span className="badge badge-muted">{work.category_name || 'Other'}</span>
              {Number(work.is_expired) ? <span className="badge badge-warn">expired</span> : <StatusBadge status={work.status} />}
            </div>

            <h3>{work.title}</h3>
            <p style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {work.description}
            </p>

            <div className="meta">
              <span><Icon name="pin" /> {work.location}</span>
              <span>
                <b>{formatMoney(work.budget)}</b>
              </span>
              <span>{formatDate(work.created_at)}</span>
              {work.status === 'open' && closesIn(work.expires_at) && <span><Icon name="clock" /> {closesIn(work.expires_at)}</span>}
            </div>

            {work.status === 'open' && (
              <div className="meta">
                <span>
                  <b>{work.total_applications}</b> application(s)
                </span>
                {work.pending_applications > 0 && (
                  <span className="badge badge-warn">{work.pending_applications} to review</span>
                )}
              </div>
            )}

            {work.provider_name && (
              <div className="meta">
                <span>
                  Provider: <b>{work.provider_name}</b>
                </span>
              </div>
            )}

            {work.status === 'completed' && !work.reviewed && (
              <span className="badge badge-warn">Review pending</span>
            )}

            <div className="card-actions" onClick={(event) => event.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => navigate(`/work/${work.id}`)}>
                {work.status === 'open' ? 'View applications' : 'View details'}
              </button>

              {work.status === 'open' && (
                <button
                  className={`btn btn-sm ${Number(work.is_expired) ? '' : 'btn-ghost'}`}
                  disabled={actions.busy}
                  onClick={() => actions.run(() => apiFetch(`/my-work/${work.id}/renew`, { method: 'PATCH' }), 'Renewed for 30 more days.')}
                >
                  Renew
                </button>
              )}

              {work.status === 'open' && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setEditing({
                      id: work.id,
                      title: work.title,
                      category_id: String(work.category_id || ''),
                      description: work.description,
                      location: work.location,
                      budget: String(work.budget),
                      image_id: work.image_id || null,
                    })
                  }
                >
                  Edit
                </button>
              )}

              {['open', 'assigned', 'in_progress'].includes(work.status) && (
                <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={() => cancelWork(work)}>
                  Cancel
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <Modal title="Edit work" onClose={() => setEditing(null)}>
          <form className="form" onSubmit={saveEdit}>
            <label className="field">
              <span>Work title</span>
              <input value={editing.title} onChange={set('title')} maxLength={150} required />
            </label>

            <label className="field">
              <span>Category</span>
              <select value={editing.category_id} onChange={set('category_id')} required>
                <option value="">Select category</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Description</span>
              <textarea value={editing.description} onChange={set('description')} required />
            </label>

            <div className="form-row">
              <label className="field">
                <span>Location</span>
                <input value={editing.location} onChange={set('location')} maxLength={200} required />
              </label>
              <label className="field">
                <span>Budget (BDT)</span>
                <input type="number" min="0" step="0.01" value={editing.budget} onChange={set('budget')} required />
              </label>
            </div>

            <PhotoField value={editing.image_id} onChange={(image_id) => setEditing((current) => ({ ...current, image_id }))} label="Photo of the work (optional)" />

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" disabled={actions.busy}>
                {actions.busy ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
