import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDate, formatMoney } from './api.js';
import { CallButton } from './calls.jsx';
import { LocationButton } from './LiveLocation.jsx';
import { PaymentButton } from './PaymentPanel.jsx';
import Icon from './Icon.jsx';
import {
  Empty,
  Feedback,
  Loading,
  Modal,
  PageHead,
  StatusBadge,
  useActions,
  useLoad,
} from './ui.jsx';

const ACTIVE = ['pending', 'accepted', 'in_progress'];

export default function MyBookings() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('active');
  const [reviewing, setReviewing] = useState(null);
  const [comment, setComment] = useState('');

  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/bookings/mine')).bookings);
  const actions = useActions(reload);

  const bookings = data || [];
  const visible = bookings.filter((b) => (tab === 'active' ? ACTIVE.includes(b.status) : !ACTIVE.includes(b.status)));

  const setStatus = (booking, status, okMessage, question) => () => {
    if (question && !window.confirm(question)) return;
    actions.run(
      () => apiFetch(`/bookings/${booking.id}/status`, { method: 'PATCH', body: { status } }),
      okMessage
    );
  };

  async function submitReview(event) {
    event.preventDefault();

    const ok = await actions.run(
      () =>
        apiFetch('/reviews', {
          method: 'POST',
          body: { booking_id: reviewing.id, comment },
        }),
      'Thanks for your review!'
    );

    if (ok) {
      setReviewing(null);
      setComment('');
    }
  }

  return (
    <div className="pg">
      <PageHead title="My bookings" subtitle="Track your requests, confirm finished work and leave reviews.">
        <button className="btn" onClick={() => navigate('/provider-services')}>
          + Book a service
        </button>
      </PageHead>

      <Feedback error={error || actions.error} notice={actions.notice} />

      <div className="tabs">
        <button className={`tab ${tab === 'active' ? 'on' : ''}`} onClick={() => setTab('active')}>
          Active <span style={{ opacity: 0.7 }}>{bookings.filter((b) => ACTIVE.includes(b.status)).length}</span>
        </button>
        <button className={`tab ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>
          History <span style={{ opacity: 0.7 }}>{bookings.filter((b) => !ACTIVE.includes(b.status)).length}</span>
        </button>
      </div>

      {loading && !data && <Loading text="Loading your bookings..." variant="cards" />}

      {data && visible.length === 0 && (
        <Empty
          title={tab === 'active' ? 'No active bookings' : 'No booking history yet'}
          text="Browse provider services to make a booking."
          action={
            <button className="btn" onClick={() => navigate('/provider-services')}>
              Find providers
            </button>
          }
        />
      )}

      <div className="grid">
        {visible.map((booking) => (
          <article className="card" key={booking.id}>
            <div className="card-row">
              <h3>{booking.service_title}</h3>
              <StatusBadge status={booking.status} />
            </div>

            <div className="meta">
              <span>
                Provider:{' '}
                <b style={{ cursor: 'pointer' }} onClick={() => navigate(`/providers/${booking.provider_id}`)}>
                  {booking.provider_name}
                </b>
              </span>
              <span><Icon name="pin" /> {booking.service_location}</span>
            </div>

            <div className="meta">
              <span>
                Date: <b>{formatDate(booking.preferred_date)}</b>
              </span>
              <span>
                Price: <b>{formatMoney(booking.service_price)}</b>
              </span>
            </div>

            <div className="quote">{booking.message}</div>

            <div className="card-actions">
              {booking.status === 'in_progress' && (
                <button
                  className="btn btn-sm"
                  disabled={actions.busy}
                  onClick={setStatus(booking, 'completed', 'Booking marked as completed.', 'Confirm the work is finished?')}
                >
                  <Icon name="check" /> Confirm completion
                </button>
              )}

              {booking.status === 'completed' && !booking.reviewed && (
                <button className="btn btn-sm" onClick={() => setReviewing(booking)}>
                  <Icon name="pen" /> Write a review
                </button>
              )}

              {['pending', 'accepted'].includes(booking.status) && (
                <button
                  className="btn btn-danger btn-sm"
                  disabled={actions.busy}
                  onClick={setStatus(booking, 'cancelled', 'Booking cancelled.', 'Cancel this booking?')}
                >
                  Cancel
                </button>
              )}

              {['accepted', 'in_progress', 'completed'].includes(booking.status) && (
                <PaymentButton bookingId={booking.id} title={`Pay for ${booking.service_title}`} />
              )}

              {['accepted', 'in_progress'].includes(booking.status) && (
                <LocationButton
                  peer={{ id: booking.provider_id, full_name: booking.provider_name }}
                  label={<><Icon name="pin" /> Track provider</>}
                />
              )}

              <CallButton peer={{ id: booking.provider_id, full_name: booking.provider_name }} />

              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages/${booking.provider_id}`)}>
                <Icon name="chat" /> Chat
              </button>
            </div>
          </article>
        ))}
      </div>

      {reviewing && (
        <Modal
          title="Write a review"
          subtitle={`${reviewing.service_title} with ${reviewing.provider_name}`}
          onClose={() => setReviewing(null)}
        >
          <Feedback error={actions.error} />
          <form className="form" onSubmit={submitReview}>
            <label className="field">
              <span>Your review</span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} minLength={5} maxLength={1000} required placeholder="How was the work? Was the provider on time and polite?" />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setReviewing(null)}>
                Cancel
              </button>
              <button className="btn" disabled={actions.busy}>
                Submit review
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
