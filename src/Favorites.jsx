import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';
import { Avatar, Empty, Feedback, Loading, PageHead, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** Heart toggle used on provider cards. */
export function HeartButton({ providerId, saved, onChange }) {
  const actions = useActions();

  async function toggle(event) {
    event.stopPropagation();
    const ok = await actions.run(() =>
      apiFetch(`/favorites/${providerId}`, { method: saved ? 'DELETE' : 'PUT' }),
      saved ? 'Removed from saved providers.' : 'Provider saved.'
    );
    if (ok && onChange) onChange(!saved);
  }

  return (
    <button
      type="button"
      className={`heart ${saved ? 'on' : ''}`}
      onClick={toggle}
      disabled={actions.busy}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved providers' : 'Save this provider'}
      title={saved ? 'Saved' : 'Save provider'}
    >
      {saved ? <Icon name="heart" filled /> : <Icon name="heart" />}
    </button>
  );
}

export default function Favorites() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/favorites')).providers);
  const actions = useActions(reload);

  return (
    <div className="pg">
      <PageHead title="Saved providers" subtitle="Providers you want to book again." />

      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading variant="cards" />}
      {data && data.length === 0 && (
        <Empty
          title="No saved providers yet"
          text="Tap the heart on a provider's card to save them here."
          action={<button className="btn" onClick={() => navigate('/provider-services')}>Find providers</button>}
        />
      )}

      <div className="grid">
        {data?.map((provider) => (
          <article className="card" key={provider.id}>
            <div className="card-row">
              <div className="person">
                <Avatar name={provider.full_name} imageId={provider.avatar_image_id} />
                <div>
                  <h3>{provider.full_name}</h3>
                  {provider.kyc_status === 'verified' && <span className="badge"><Icon name="check" /> ID verified</span>}
                </div>
              </div>
              <button
                type="button"
                className="heart on"
                aria-label="Remove from saved providers"
                onClick={() => actions.run(() => apiFetch(`/favorites/${provider.id}`, { method: 'DELETE' }), 'Removed from saved providers.')}
              >
                <Icon name="heart" filled />
              </button>
            </div>
            <div className="meta"><span>{provider.listing_count} active service(s)</span></div>
            <div className="card-actions">
              <button className="btn btn-sm" onClick={() => navigate(`/providers/${provider.id}`)}>View profile</button>
              <button className="btn btn-soft btn-sm" onClick={() => navigate(`/messages/${provider.id}`)}>Chat</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
