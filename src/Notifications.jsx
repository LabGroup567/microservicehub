import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDateTime } from './api.js';
import { PushToggle } from './PushToggle.jsx';
import { Empty, Feedback, Loading, PageHead, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const ICONS = {
  application_new: <Icon name="mail" />,
  application_accepted: <Icon name="party" />,
  application_rejected: <Icon name="x" />,
  work_new: <Icon name="sparkles" />,
  work_started: <Icon name="wrench" />,
  work_completed: <Icon name="check-circle" />,
  work_cancelled: <Icon name="ban" />,
  work_withdrawn: '↩',
  booking_new: <Icon name="calendar" />,
  booking_status: <Icon name="pin-small" />,
  review_new: <Icon name="star" filled />,
  nid_status: <Icon name="id" />,
  moderation: <Icon name="alert" />,
};

export default function Notifications() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/notifications')).notifications);
  const actions = useActions(() => reload(true));

  // Refresh periodically so new notifications appear without a reload.
  useEffect(() => {
    const timer = window.setInterval(() => reload(true), 15000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const notifications = data || [];
  const unread = notifications.filter((n) => !n.is_read).length;

  async function open(notification) {
    if (!notification.is_read) {
      await apiFetch(`/notifications/${notification.id}/read`, { method: 'PATCH' }).catch(() => {});
    }
    if (notification.link) navigate(notification.link);
    else reload(true);
  }

  return (
    <div className="pg pg-narrow">
      <PageHead
        title="Notifications"
        subtitle={unread ? `You have ${unread} unread notification(s).` : 'You are all caught up.'}
      >
        <PushToggle />
        {unread > 0 && (
          <button
            className="btn btn-ghost"
            disabled={actions.busy}
            onClick={() => actions.run(() => apiFetch('/notifications/read-all', { method: 'PATCH' }), 'All marked as read.')}
          >
            Mark all as read
          </button>
        )}
      </PageHead>

      <Feedback error={error || actions.error} />

      {loading && !data && <Loading />}

      {data && notifications.length === 0 && (
        <Empty title="No notifications yet" text="Updates about applications, bookings and payments show up here." />
      )}

      <div className="stack" style={{ gap: 10 }}>
        {notifications.map((notification) => (
          <button
            key={notification.id}
            className={`notif ${notification.is_read ? '' : 'unread'}`}
            onClick={() => open(notification)}
          >
            <span className="notif-dot" />
            <span style={{ fontSize: '1.3rem' }}>{ICONS[notification.type] || <Icon name="bell" />}</span>
            <span style={{ flex: 1 }}>
              <strong>{notification.title}</strong>
              {notification.body && <p>{notification.body}</p>}
              <small>{formatDateTime(notification.created_at)}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
