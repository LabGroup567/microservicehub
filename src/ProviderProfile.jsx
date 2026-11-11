import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch, formatDate, imageUrl } from './api.js';
import { useAuth } from './auth.jsx';
import { PhotoField } from './Photos.jsx';
import { Avatar, Empty, Feedback, Loading, Modal, ReportDialog, StatusBadge, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** Photos of finished work. The provider manages them here; everyone else just looks. */
function Portfolio({ providerId, isMe, name }) {
  const { data, reload } = useLoad(() => apiFetch(`/providers/${providerId}/portfolio`), [providerId]);
  const actions = useActions(reload);
  const [caption, setCaption] = useState('');
  const [open, setOpen] = useState(null);

  const items = data?.items || [];
  if (!isMe && items.length === 0) return null;

  async function add(imageId) {
    if (!imageId) return;
    const ok = await actions.run(
      () => apiFetch('/portfolio', { method: 'POST', body: { image_id: imageId, caption } }),
      'Photo added to your portfolio.'
    );
    if (ok) setCaption('');
  }

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <h2>{isMe ? 'My portfolio' : 'Past work'}</h2>
      <p className="sub">
        {isMe
          ? 'Show photos of work you have finished. Customers trust providers who show their work. Up to 12 photos.'
          : `Photos of work done by ${name}.`}
      </p>

      {(actions.error || actions.notice) && (
        <p className={actions.error ? 'field-error' : 'hint'}>{actions.error || actions.notice}</p>
      )}

      {items.length > 0 && (
        <div className="portfolio">
          {items.map((item) => (
            <figure key={item.id} className="portfolio-item">
              <button type="button" className="portfolio-open" onClick={() => setOpen(item)} aria-label={item.caption || 'Open photo'}>
                <img src={imageUrl(item.image_id)} alt={item.caption || `Work by ${name}`} loading="lazy" />
              </button>
              {item.caption && <figcaption>{item.caption}</figcaption>}
              {isMe && (
                <button
                  type="button"
                  className="portfolio-remove"
                  disabled={actions.busy}
                  onClick={() => window.confirm('Remove this photo?') && actions.run(() => apiFetch(`/portfolio/${item.id}`, { method: 'DELETE' }), 'Photo removed.')}
                  aria-label="Remove photo"
                >
                  <Icon name="x" />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}

      {isMe && items.length < 12 && (
        <div className="portfolio-add">
          <label className="field">
            <span>Caption (optional)</span>
            <input value={caption} maxLength={120} onChange={(event) => setCaption(event.target.value)} placeholder="e.g. Fixed a kitchen sink in Mirpur" />
          </label>
          <PhotoField value={null} onChange={add} label="Add a photo of finished work" />
        </div>
      )}

      {open && (
        <Modal title={open.caption || `Work by ${name}`} onClose={() => setOpen(null)}>
          <img className="portfolio-big" src={imageUrl(open.image_id)} alt={open.caption || `Work by ${name}`} />
        </Modal>
      )}
    </section>
  );
}

export default function ProviderProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);

  const { data, loading, error } = useLoad(() => apiFetch(`/providers/${id}/reviews`), [id]);

  if (loading) return <div className="pg pg-narrow"><Loading /></div>;
  if (error || !data) {
    return (
      <div className="pg pg-narrow">
        <button className="back-link" onClick={() => navigate(-1)}>← Back</button>
        <Feedback error={error || 'Provider not found.'} />
      </div>
    );
  }

  const { provider, reviews } = data;
  const isMe = provider.id === user.id;

  return (
    <div className="pg pg-narrow">
      <button className="back-link" onClick={() => navigate(-1)}>← Back</button>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="card-row">
          <div className="person">
            <Avatar name={provider.full_name} imageId={provider.avatar_image_id} />
            <div>
              <strong style={{ fontSize: '1.25rem' }}>{provider.full_name}</strong>
              <small>Provider since {formatDate(provider.created_at)}</small>
            </div>
          </div>
          {provider.nid_status === 'verified' && <span className="badge"><Icon name="check" /> ID verified</span>}
          {provider.nid_status !== 'verified' && <StatusBadge status="pending" />}
        </div>

        <p style={{ margin: '16px 0', color: 'var(--mh-muted)' }}>
          {provider.bio || 'This provider has not added a bio yet.'}
        </p>

        <p style={{ margin: '0 0 16px', color: 'var(--mh-muted)' }}>
          {provider.review_count} {Number(provider.review_count) === 1 ? 'review' : 'reviews'}
        </p>

        {!isMe && (
          <div className="pg-actions">
            <button className="btn" onClick={() => navigate(`/messages/${provider.id}`)}>
              <Icon name="chat" /> Message
            </button>
            <button className="btn btn-ghost" onClick={() => setReport({ type: 'user', id: provider.id })}>
              <Icon name="flag" /> Report
            </button>
          </div>
        )}
      </section>

      <Portfolio providerId={provider.id} isMe={isMe} name={provider.full_name} />

      <section className="panel">
        <h2>Reviews</h2>
        <p className="sub">What customers say about working with {provider.full_name}.</p>

        {reviews.length === 0 && (
          <Empty title="No reviews yet" text="Reviews appear here after completed work." />
        )}

        {reviews.map((review) => (
          <div className="review" key={review.id}>
            <div className="card-row">
              <strong>{review.reviewer_name}</strong>
              <small>{formatDate(review.created_at)}</small>
            </div>
            {review.comment && <p>{review.comment}</p>}
          </div>
        ))}
      </section>

      {report && <ReportDialog report={report} onClose={() => setReport(null)} />}
    </div>
  );
}
