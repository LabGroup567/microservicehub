import { apiFetch, formatDateTime } from './api.js';
import { Empty, Feedback, Loading, useActions, useLoad } from './ui.jsx';

/** Messages sent from the public Contact page. */
export default function AdminContact() {
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/admin/contact')).messages);
  const actions = useActions(reload);

  return (
    <>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="No messages" text="Messages from the Contact page appear here." />}

      <div className="stack">
        {data?.map((item) => (
          <article className={`card ${item.handled ? 'is-handled' : ''}`} key={item.id}>
            <div className="card-row">
              <h3>{item.name}</h3>
              <span className={`badge ${item.handled ? 'badge-muted' : 'badge-warn'}`}>{item.handled ? 'Handled' : 'New'}</span>
            </div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>
            <div className="meta">
              <a href={`mailto:${item.email}`}>{item.email}</a>
              <span>{formatDateTime(item.created_at)}</span>
            </div>
            <div className="card-actions">
              <button
                className="btn btn-soft btn-sm"
                disabled={actions.busy}
                onClick={() => actions.run(() => apiFetch(`/admin/contact/${item.id}/handled`, { method: 'PATCH', body: { handled: !item.handled } }))}
              >
                {item.handled ? 'Mark as new' : 'Mark as handled'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
