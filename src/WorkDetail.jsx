import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch, closesIn, formatDate, formatMoney } from './api.js';
import { useAuth } from './auth.jsx';
import { CallButton } from './calls.jsx';
import { LocationButton } from './LiveLocation.jsx';
import { PaymentPanel } from './PaymentPanel.jsx';
import { Thumb } from './Photos.jsx';
import Icon from './Icon.jsx';
import {
  Avatar,
  Empty,
  Feedback,
  Loading,
  ReportDialog,
  StatusBadge,
  useActions,
  useLoad,
} from './ui.jsx';

const STEPS = [
  ['open', 'Posted'],
  ['assigned', 'Hired'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
];

function Timeline({ status }) {
  if (status === 'cancelled') {
    return (
      <div className="timeline cancelled">
        <div className="step done">Posted</div>
        <div className="step done">Cancelled</div>
      </div>
    );
  }

  const index = STEPS.findIndex(([key]) => key === status);

  return (
    <div className="timeline">
      {STEPS.map(([key, label], i) => (
        <div key={key} className={`step ${i <= index ? 'done' : ''}`}>
          {label}
        </div>
      ))}
    </div>
  );
}

export default function WorkDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, loading, error, reload } = useLoad(() => apiFetch(`/work/${id}`), [id]);
  const actions = useActions(reload);

  const [message, setMessage] = useState('');
  const [offer, setOffer] = useState('');
  const [comment, setComment] = useState('');
  const [report, setReport] = useState(null);

  if (loading && !data) return <div className="pg"><Loading /></div>;
  if (!data) {
    return (
      <div className="pg">
        <button className="back-link" onClick={() => navigate(-1)}>← Back</button>
        <Feedback error={error || 'Work not found.'} />
      </div>
    );
  }

  const { work, applications, my_application: mine, review } = data;
  const isOwner = work.seeker_id === user.id;
  const isAssigned = work.assigned_provider_id === user.id;
  const isProvider = user.role === 'provider';
  const expired = Number(work.is_expired) === 1;
  const canApply = isProvider && work.status === 'open' && !expired && !mine;
  const offered = applications.filter((a) => a.offer_price != null && a.status !== 'rejected').map((a) => Number(a.offer_price));
  const lowestOffer = offered.length > 1 ? Math.min(...offered) : null;

  const patch = (path, okMessage) => () =>
    actions.run(() => apiFetch(path, { method: 'PATCH' }), okMessage);

  async function apply(event) {
    event.preventDefault();
    const ok = await actions.run(
      () =>
        apiFetch('/applications', {
          method: 'POST',
          body: { service_id: work.id, message, ...(offer !== '' ? { offer_price: Number(offer) } : {}) },
        }),
      'Application submitted. The seeker has been notified.'
    );
    if (ok) {
      setMessage('');
      setOffer('');
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    await actions.run(
      () =>
        apiFetch('/reviews', {
          method: 'POST',
          body: { service_id: work.id, comment },
        }),
      'Thanks for your review!'
    );
  }

  function confirm(text, action) {
    if (window.confirm(text)) action();
  }

  return (
    <div className="pg">
      <button className="back-link" onClick={() => navigate(-1)}>← Back</button>

      <Feedback error={error || actions.error} notice={actions.notice} />

      <div className="detail">
        <div className="stack">
          <section className="panel">
            <Thumb imageId={work.image_id} label={work.title} className="thumb-hero" />
            <div className="card-row">
              <span className="badge badge-muted">{work.category_name || 'Other'}</span>
              <StatusBadge status={work.status} />
            </div>

            <h1 style={{ margin: '12px 0 8px', color: 'var(--mh-dark)', letterSpacing: '-0.02em' }}>
              {work.title}
            </h1>

            <div className="meta" style={{ marginBottom: 16 }}>
              <span><Icon name="pin" /> {work.location}</span>
              <span>Posted {formatDate(work.created_at)}</span>
              <span>
                by <b>{work.seeker_name}</b>
              </span>
              {work.status === 'open' && closesIn(work.expires_at) && <span><Icon name="clock" /> {closesIn(work.expires_at)}</span>}
            </div>

            {expired && (
              <div className="notice-bar">
                <span>This work has expired, so providers can no longer apply.</span>
                {isOwner && (
                  <button
                    className="btn btn-sm"
                    disabled={actions.busy}
                    onClick={() => actions.run(() => apiFetch(`/my-work/${work.id}/renew`, { method: 'PATCH' }), 'Renewed for 30 more days.')}
                  >
                    Renew for 30 days
                  </button>
                )}
              </div>
            )}

            <p style={{ margin: '0 0 20px', color: 'var(--mh-text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {work.description}
            </p>

            <Timeline status={work.status} />
          </section>

          {(isOwner || user.role === 'admin') && (
            <section className="panel">
              <h2>Applications</h2>
              <p className="sub">
                {applications.length
                  ? 'Review providers and hire the best fit.'
                  : 'No providers have applied yet. They will appear here.'}
              </p>

              <div className="stack">
                {applications.length === 0 && (
                  <Empty title="Waiting for applications" text="You will be notified when a provider applies." />
                )}

                {applications.map((application) => (
                  <div className="card" key={application.id}>
                    <div className="card-row">
                      <div className="person">
                        <Avatar name={application.provider_name} imageId={application.provider_avatar} />
                        <div>
                          <strong>{application.provider_name}</strong>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <StatusBadge status={application.status} />
                        {application.nid_status === 'verified' && (
                          <div style={{ marginTop: 4 }}>
                            <span className="badge"><Icon name="check" /> ID verified</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {application.offer_price != null && (
                      <div className="offer-line">
                        <span>Offer</span>
                        <strong>{formatMoney(application.offer_price)}</strong>
                        {Number(application.offer_price) !== Number(work.budget) && (
                          <small>
                            {Number(application.offer_price) < Number(work.budget) ? 'below' : 'above'} your budget of {formatMoney(work.budget)}
                          </small>
                        )}
                        {lowestOffer !== null && Number(application.offer_price) === lowestOffer && application.status !== 'rejected' && (
                          <span className="badge">Lowest offer</span>
                        )}
                      </div>
                    )}
                    <div className="quote">{application.message}</div>
                    <small style={{ color: 'var(--mh-muted)' }}>Applied {formatDate(application.created_at)}</small>

                    <div className="card-actions">
                      {isOwner && application.status === 'pending' && work.status === 'open' && (
                        <>
                          <button
                            className="btn btn-sm"
                            disabled={actions.busy || expired}
                            onClick={() =>
                              confirm(
                                `Hire ${application.provider_name}${application.offer_price != null ? ` for ${formatMoney(application.offer_price)}` : ''}? Other applicants will be declined.`,
                                patch(`/applications/${application.id}/accept`, 'Provider hired. Others were notified.')
                              )
                            }
                          >
                            Accept
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={actions.busy}
                            onClick={patch(`/applications/${application.id}/reject`, 'Application rejected.')}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/messages/${application.provider_id}`)}
                      >
                        <Icon name="chat" /> Chat
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/providers/${application.provider_id}`)}
                      >
                        Profile
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="panel">
            <span className="stat" style={{ display: 'block', border: 'none', padding: 0, boxShadow: 'none' }}>
              <span>Budget</span>
              <strong className="price" style={{ fontSize: '1.8rem' }}>{formatMoney(work.budget)}</strong>
            </span>

            {work.provider_name && (
              <div className="person" style={{ marginTop: 16 }}>
                <Avatar name={work.provider_name} imageId={work.provider_avatar} />
                <div>
                  <strong>{work.provider_name}</strong>
                  <small>Hired provider</small>
                </div>
              </div>
            )}

            {isOwner && (
              <div className="stack" style={{ marginTop: 16, gap: 10 }}>
                {work.status === 'in_progress' && (
                  <button
                    className="btn btn-block"
                    disabled={actions.busy}
                    onClick={() =>
                      confirm(
                        'Confirm the work is finished? This marks it as completed.',
                        patch(`/work/${work.id}/complete`, 'Work marked as completed.')
                      )
                    }
                  >
                    <Icon name="check" /> Confirm completion
                  </button>
                )}

                {work.assigned_provider_id && (
                  <button className="btn btn-ghost btn-block" onClick={() => navigate(`/messages/${work.assigned_provider_id}`)}>
                    <Icon name="chat" /> Chat with provider
                  </button>
                )}

                {work.assigned_provider_id && (
                  <CallButton peer={{ id: work.assigned_provider_id, full_name: work.provider_name }} label={<><Icon name="phone" /> Call provider</>} />
                )}

                {work.assigned_provider_id && ['assigned', 'in_progress'].includes(work.status) && (
                  <LocationButton
                    peer={{ id: work.assigned_provider_id, full_name: work.provider_name }}
                    label={<><Icon name="pin" /> Track provider live location</>}
                  />
                )}

                {['open', 'assigned', 'in_progress'].includes(work.status) && (
                  <button
                    className="btn btn-danger btn-block"
                    disabled={actions.busy}
                    onClick={() =>
                      confirm('Cancel this work?', patch(`/my-work/${work.id}/cancel`, 'Work cancelled.'))
                    }
                  >
                    Cancel work
                  </button>
                )}
              </div>
            )}

            {isAssigned && (
              <div className="stack" style={{ marginTop: 16, gap: 10 }}>
                {work.status === 'assigned' && (
                  <button className="btn btn-block" disabled={actions.busy} onClick={patch(`/work/${work.id}/start`, 'Work started.')}>
                    ▶ Start work
                  </button>
                )}
                {work.status === 'in_progress' && (
                  <p className="quote">Work is in progress. The seeker confirms completion when finished.</p>
                )}
                <button className="btn btn-ghost btn-block" onClick={() => navigate(`/messages/${work.seeker_id}`)}>
                  <Icon name="chat" /> Chat with seeker
                </button>
                <CallButton peer={{ id: work.seeker_id, full_name: work.seeker_name }} label={<><Icon name="phone" /> Call seeker</>} />
                {['assigned', 'in_progress'].includes(work.status) && (
                  <LocationButton
                    peer={{ id: work.seeker_id, full_name: work.seeker_name }}
                    label={<><Icon name="pin" /> Share my live location</>}
                  />
                )}
                {['assigned', 'in_progress'].includes(work.status) && (
                  <button
                    className="btn btn-danger btn-block"
                    disabled={actions.busy}
                    onClick={() =>
                      confirm(
                        'Withdraw from this work? It will reopen for other providers.',
                        patch(`/work/${work.id}/withdraw`, 'You withdrew from this work.')
                      )
                    }
                  >
                    Withdraw
                  </button>
                )}
              </div>
            )}

            {isProvider && !isAssigned && mine && (
              <div style={{ marginTop: 16 }}>
                <div className="card-row">
                  <strong>Your application</strong>
                  <StatusBadge status={mine.status} />
                </div>
                {mine.offer_price != null && (
                  <p style={{ margin: '10px 0 0' }}>
                    Your offer: <b>{formatMoney(mine.offer_price)}</b>
                  </p>
                )}
                <div className="quote" style={{ marginTop: 10 }}>{mine.message}</div>
                <button
                  className="btn btn-ghost btn-block"
                  style={{ marginTop: 10 }}
                  onClick={() => navigate(`/messages/${work.seeker_id}`)}
                >
                  <Icon name="chat" /> Chat with seeker
                </button>
              </div>
            )}

            {!isOwner && (
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setReport({ type: 'work', id: work.id })}>
                  <Icon name="flag" /> Report this post
                </button>
              </div>
            )}
          </section>

          {(isOwner || isAssigned) &&
            work.assigned_provider_id &&
            ['assigned', 'in_progress', 'completed'].includes(work.status) && (
              <section className="panel">
                <h2>Payment</h2>
                <p className="sub">Pay by cash on delivery, bKash or Nagad.</p>
                <PaymentPanel workId={work.id} />
              </section>
            )}

          {canApply && (
            <section className="panel">
              <h2>Apply for this work</h2>
              <p className="sub">Introduce yourself and explain why you are a good fit.</p>
              <form className="form" onSubmit={apply}>
                <label className="field">
                  <span>Your message</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    minLength={5}
                    maxLength={1000}
                    required
                    placeholder="Describe your experience and availability..."
                  />
                </label>
                <label className="field">
                  <span>Your price in BDT (optional)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={offer}
                    onChange={(event) => setOffer(event.target.value)}
                    placeholder={`Budget: ${Math.round(Number(work.budget))}`}
                  />
                  <small className="hint">Leave empty to accept the budget. If the seeker hires you, your price becomes the price of the job.</small>
                </label>
                <button className="btn" disabled={actions.busy}>
                  {actions.busy ? 'Submitting...' : 'Submit application'}
                </button>
              </form>
            </section>
          )}

          {isOwner && work.status === 'completed' && (
            <section className="panel">
              <h2>Review the provider</h2>
              {review ? (
                <>
                  <p className="sub">Your review</p>
                  {review.comment && <div className="quote" style={{ marginTop: 10 }}>{review.comment}</div>}
                </>
              ) : (
                <>
                  <p className="sub">How was working with {work.provider_name}?</p>
                  <form className="form" onSubmit={submitReview}>
                    <label className="field">
                      <span>Your review</span>
                      <textarea value={comment} onChange={(event) => setComment(event.target.value)} minLength={5} maxLength={1000} required placeholder="How was the work? Was the provider on time and polite?" />
                    </label>
                    <button className="btn" disabled={actions.busy}>
                      Submit review
                    </button>
                  </form>
                </>
              )}
            </section>
          )}
        </aside>
      </div>

      {report && <ReportDialog report={report} onClose={() => setReport(null)} />}
    </div>
  );
}
