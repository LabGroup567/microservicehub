import { useState } from 'react';
import { apiFetch, formatMoney } from './api.js';
import { Empty, Feedback, Loading, Modal, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';
import { PhotoField, Thumb } from './Photos.jsx';
import Availability from './Availability.jsx';
import Icon from './Icon.jsx';

const BLANK = { id: null, title: '', category_id: '', description: '', location: '', price: '', image_id: null, credential: '' };

export default function MyServices() {
  const [editing, setEditing] = useState(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [listings, cats] = await Promise.all([apiFetch('/my-listings'), apiFetch('/categories')]);
    return { listings: listings.listings, categories: cats.categories };
  });

  const actions = useActions(reload);
  const set = (key) => (event) => setEditing((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();

    const body = {
      category_id: Number(editing.category_id),
      title: editing.title,
      description: editing.description,
      location: editing.location,
      price: Number(editing.price),
      image_id: editing.image_id || null,
      credential: editing.credential || '',
    };

    const ok = await actions.run(
      () =>
        editing.id
          ? apiFetch(`/my-listings/${editing.id}`, { method: 'PUT', body })
          : apiFetch('/my-listings', { method: 'POST', body }),
      editing.id ? 'Listing updated.' : 'Service listing created.'
    );

    if (ok) setEditing(null);
  }

  function toggle(listing) {
    const status = listing.status === 'active' ? 'inactive' : 'active';
    actions.run(
      () => apiFetch(`/my-listings/${listing.id}/status`, { method: 'PATCH', body: { status } }),
      status === 'active' ? 'Listing is live again.' : 'Listing paused. Customers will not see it.'
    );
  }

  const listings = data?.listings || [];

  return (
    <div className="pg">
      <PageHead title="My services" subtitle="The services you offer. Customers can book these directly.">
        <button className="btn" onClick={() => setEditing(BLANK)}>
          + New service
        </button>
      </PageHead>

      <Feedback error={error || (!editing ? actions.error : '')} notice={!editing ? actions.notice : ''} />

      <Availability />

      {loading && !data && <Loading variant="cards" />}

      {data && listings.length === 0 && (
        <Empty
          title="You have not listed any service"
          text="Create a listing so customers can find and book you."
          action={
            <button className="btn" onClick={() => setEditing(BLANK)}>
              Create your first service
            </button>
          }
        />
      )}

      <div className="grid">
        {listings.map((listing) => (
          <article className="card" key={listing.id}>
            <Thumb imageId={listing.image_id} label={listing.title} />
            <div className="card-row">
              <span className="badge badge-muted">{listing.category_name || 'Other'}</span>
              {listing.is_hidden ? <StatusBadge status="hidden" /> : <StatusBadge status={listing.status} />}
            </div>

            <h3>{listing.title}</h3>
            <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {listing.description}
            </p>

            <div className="meta">
              <span><Icon name="pin" /> {listing.location}</span>
              <span>
                <b>{formatMoney(listing.price)}</b>
              </span>
              <span>{listing.booking_count} booking(s)</span>
            </div>

            {listing.is_hidden ? (
              <p className="alert" style={{ margin: 0 }}>
                Removed by a moderator. Contact support if you think this is a mistake.
              </p>
            ) : null}

            <div className="card-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setEditing({
                    id: listing.id,
                    title: listing.title,
                    category_id: String(listing.category_id || ''),
                    description: listing.description,
                    location: listing.location,
                    price: String(listing.price),
                    image_id: listing.image_id || null,
                    credential: listing.credential || '',
                  })
                }
              >
                Edit
              </button>

              {!listing.is_hidden && (
                <button className="btn btn-soft btn-sm" disabled={actions.busy} onClick={() => toggle(listing)}>
                  {listing.status === 'active' ? 'Pause' : 'Activate'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit service' : 'New service'} onClose={() => setEditing(null)}>
          <Feedback error={actions.error} />
          <form className="form" onSubmit={save}>
            <label className="field">
              <span>Service title</span>
              <input value={editing.title} onChange={set('title')} maxLength={150} placeholder="e.g. Home deep cleaning" required />
            </label>

            <label className="field">
              <span>Category</span>
              <select value={editing.category_id} onChange={set('category_id')} required>
                <option value="">Select category</option>
                {data.categories.filter((category) => !['Ambulance', 'Online Doctor'].includes(category.name)).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Description</span>
              <textarea value={editing.description} onChange={set('description')} required placeholder="What do you offer and what is included?" />
            </label>

            <div className="form-row">
              <label className="field">
                <span>Location / area</span>
                <input value={editing.location} onChange={set('location')} maxLength={200} required />
              </label>
              <label className="field">
                <span>Price (BDT)</span>
                <input type="number" min="0" step="0.01" value={editing.price} onChange={set('price')} required />
              </label>
            </div>

            <PhotoField value={editing.image_id} onChange={(image_id) => setEditing((current) => ({ ...current, image_id }))} />

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" disabled={actions.busy}>
                {actions.busy ? 'Saving...' : 'Save service'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
