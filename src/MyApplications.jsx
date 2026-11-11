import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDate, formatMoney } from './api.js';
import { CallButton } from './calls.jsx';
import { LocationButton } from './LiveLocation.jsx';
import { PaymentButton } from './PaymentPanel.jsx';
import { Empty, Feedback, Loading, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const TABS = [
  ['all', 'All', () => true],
  ['pending', 'Pending', (a) => a.status === 'pending'],
  [
    'active',
    'Active jobs',
    (a) => a.status === 'accepted' && ['assigned', 'in_progress'].includes(a.work_status),
  ],
  ['done', 'Completed', (a) => a.status === 'accepted' && a.work_status === 'completed'],
  [
    'closed',
    'Closed',
    (a) => a.status === 'rejected' || (a.status === 'accepted' && a.work_status === 'cancelled'),
  ],
];

export default function MyApplications() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');

  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/my-applications')).applications);
  const actions = useActions(reload);

  const applications = data || [];
  const filter = TABS.find((t) => t[0] === tab)[2];
  const visible = applications.filter(filter);

  const act = (application, action, okMessage, question) => () => {
    if (question && !window.confirm(question)) return;
    actions.run(() => apiFetch(`/work/${application.service_id}/${action}`, { method: 'PATCH' }), okMessage);
  };

  return (
    <div className="pg">
      <PageHead title="My applications" subtitle="Track your applications and manage the jobs you won.">
        <button className="btn" onClick={() => navigate('/services')}>
          Find more work
        </button>
      </PageHead>

      <Feedback error={error || actions.error} notice={actions.notice} />

      <div className="tabs">
        {TABS.map(([key, label, test]) => (
          <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
            {label} <span style={{ opacity: 0.7 }}>{applications.filter(test).length}</span>
          </button>
        ))}
      </div>

      {loading && !data && <Loading text="Loading your applications..." variant="cards" />}

      {data && visible.length === 0 && (
        <Empty
          title={applications.length ? 'Nothing in this tab' : 'No applications yet'}
          text="Find open work requests and apply to get started."
          action={
            <button className="btn" onClick={() => navigate('/services')}>
              Find work
            </button>
          }
        />
      )}

      <div className="grid">
        {visible.map((application) => {
          const won = application.status === 'accepted';

          return (
            <article className="card" key={application.id}>
              <div className="card-row">
                <span className="badge badge-muted">{application.category_name || 'Other'}</span>
                <StatusBadge status={application.status} />
              </div>

              <h3>{application.service_title}</h3>

              <div className="meta">
                <span><Icon name="pin" /> {application.service_location}</span>
                <span>
                  <b>{formatMoney(application.service_budget)}</b>
                </span>
                <span>
                  Seeker: <b>{application.seeker_name}</b>
                </span>
              </div>

              {won && (
                <div className="meta">
                  <span>
                    Job status: <StatusBadge status={application.work_status} />
                  </span>
                </div>
              )}

              {application.offer_price != null && (
                <div className="meta">
                  <span>
                    Your offer: <b>{formatMoney(application.offer_price)}</b>
                  </span>
                </div>
              )}

              <div className="quote">{application.message}</div>
              <small style={{ color: 'var(--mh-muted)' }}>Applied {formatDate(application.created_at)}</small>

              <div className="card-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/work/${application.service_id}`)}>
                  View work
                </button>

                {application.status === 'pending' && (
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={actions.busy}
                    onClick={() => {
                      if (!window.confirm('Withdraw this application?')) return;
                      actions.run(
                        () => apiFetch(`/applications/${application.id}`, { method: 'DELETE' }),
                        'Application withdrawn.'
                      );
                    }}
                  >
                    Withdraw application
                  </button>
                )}

                {won && application.work_status === 'assigned' && (
                  <button
                    className="btn btn-sm"
                    disabled={actions.busy}
                    onClick={act(application, 'start', 'Work started. The seeker was notified.')}
                  >
                    ▶ Start work
                  </button>
                )}

                {won && ['assigned', 'in_progress'].includes(application.work_status) && (
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={actions.busy}
                    onClick={act(
                      application,
                      'withdraw',
                      'You withdrew from this work.',
                      'Withdraw from this work? It will reopen for other providers.'
                    )}
                  >
                    Withdraw
                  </button>
                )}

                {won && ['assigned', 'in_progress'].includes(application.work_status) && (
                  <LocationButton
                    peer={{ id: application.seeker_id, full_name: application.seeker_name }}
                    label={<><Icon name="pin" /> Share location</>}
                  />
                )}

                {won && ['assigned', 'in_progress', 'completed'].includes(application.work_status) && (
                  <PaymentButton workId={application.service_id} title={`Payment for ${application.service_title}`} />
                )}

                {application.status !== 'rejected' && (
                  <CallButton peer={{ id: application.seeker_id, full_name: application.seeker_name }} />
                )}

                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`/messages/${application.seeker_id}`)}
                >
                  <Icon name="chat" /> Chat
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
