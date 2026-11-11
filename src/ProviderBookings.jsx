import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDate, formatMoney } from './api.js';
import { CallButton } from './calls.jsx';
import { LocationButton } from './LiveLocation.jsx';
import { PaymentButton } from './PaymentPanel.jsx';
import { Empty, Feedback, Loading, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const ACTIVE = ['pending', 'accepted', 'in_progress'];

export default function ProviderBookings() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('active');

  const { data, loading, error, reload } = useLoad(async () => {
    const [bookings, overview] = await Promise.all([apiFetch('/bookings/incoming'), apiFetch('/provider/overview')]);
    return { bookings: bookings.bookings, overview: overview.overview };
  });

  const actions = useActions(reload);

  const bookings = data?.bookings || [];
  const overview = data?.overview;
  const visible = bookings.filter((b) => (tab === 'active' ? ACTIVE.includes(b.status) : !ACTIVE.includes(b.status)));

  const setStatus = (booking, status, okMessage, question) => () => {
    if (question && !window.confirm(question)) return;
    actions.run(
      () => apiFetch(`/bookings/${booking.id}/status`, { method: 'PATCH', body: { status } }),
      okMessage
    );
  };

  return (
    <div className="pg">
      <PageHead title="Bookings and earnings" subtitle="Manage customer bookings and see how your business is doing." />

      <Feedback error={error || actions.error} notice={actions.notice} />

      {overview && (
        <div className="stats">
          <div className="stat hero">
            <span>Total earnings</span>
            <strong>{formatMoney(overview.total_earnings)}</strong>
            <small>
              {formatMoney(overview.booking_earnings)} bookings · {formatMoney(overview.job_earnings)} jobs
            </small>
          </div>
          <div className="stat">
            <span>Received</span>
            <strong>{formatMoney(overview.received)}</strong>
            <small>{overview.payments_to_confirm} payment(s) to confirm</small>
          </div>
          <div className="stat">
            <span>New requests</span>
            <strong>{overview.pending_bookings}</strong>
          </div>
          <div className="stat">
            <span>Active</span>
            <strong>{Number(overview.active_bookings) + Number(overview.active_jobs)}</strong>
            <small>bookings and jobs</small>
          </div>
          <div className="stat">
            <span>Completed</span>
            <strong>{Number(overview.completed_bookings) + Number(overview.completed_jobs)}</strong>
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === 'active' ? 'on' : ''}`} onClick={() => setTab('active')}>
          Active <span style={{ opacity: 0.7 }}>{bookings.filter((b) => ACTIVE.includes(b.status)).length}</span>
        </button>
        <button className={`tab ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>
          History <span style={{ opacity: 0.7 }}>{bookings.filter((b) => !ACTIVE.includes(b.status)).length}</span>
        </button>
      </div>

      {loading && !data && <Loading variant="cards" />}

      {data && visible.length === 0 && (
        <Empty
          title={tab === 'active' ? 'No active bookings' : 'No booking history'}
          text="Bookings appear here when customers book your services."
          action={
            <button className="btn" onClick={() => navigate('/my-services')}>
              Manage my services
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
                Customer: <b>{booking.customer_name}</b>
              </span>
              <span>
                Date: <b>{formatDate(booking.preferred_date)}</b>
              </span>
              <span>
                <b>{formatMoney(booking.service_price)}</b>
              </span>
            </div>

            <div className="quote">{booking.message}</div>

            <div className="card-actions">
              {booking.status === 'pending' && (
                <>
                  <button
                    className="btn btn-sm"
                    disabled={actions.busy}
                    onClick={setStatus(booking, 'accepted', 'Booking accepted.')}
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={actions.busy}
                    onClick={setStatus(booking, 'rejected', 'Booking rejected.', 'Reject this booking?')}
                  >
                    Reject
                  </button>
                </>
              )}

              {booking.status === 'accepted' && (
                <button
                  className="btn btn-sm"
                  disabled={actions.busy}
                  onClick={setStatus(booking, 'in_progress', 'Work started.')}
                >
                  ▶ Start work
                </button>
              )}

              {booking.status === 'in_progress' && (
                <span className="badge badge-warn">Waiting for the customer to confirm completion</span>
              )}

              {['accepted', 'in_progress'].includes(booking.status) && (
                <button
                  className="btn btn-danger btn-sm"
                  disabled={actions.busy}
                  onClick={setStatus(booking, 'cancelled', 'Booking cancelled.', 'Cancel this booking?')}
                >
                  Cancel
                </button>
              )}

              {['accepted', 'in_progress', 'completed'].includes(booking.status) && (
                <PaymentButton bookingId={booking.id} title={`Payment for ${booking.service_title}`} />
              )}

              {['accepted', 'in_progress'].includes(booking.status) && (
                <LocationButton
                  peer={{ id: booking.customer_id, full_name: booking.customer_name }}
                  label={<><Icon name="pin" /> Share location</>}
                />
              )}

              <CallButton peer={{ id: booking.customer_id, full_name: booking.customer_name }} />

              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages/${booking.customer_id}`)}>
                <Icon name="chat" /> Chat
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
