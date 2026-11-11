import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDate, formatMoney } from './api.js';
import { useAuth } from './auth.jsx';
import { KycDocument } from './Kyc.jsx';
import { AdminDisputes, AdminFees, AdminPayments } from './AdminMoney.jsx';
import AdminContact from './AdminContact.jsx';
import AdminLocations from './AdminLocations.jsx';
import AdminEmergency from './AdminEmergency.jsx';
import AdminReport from './AdminReport.jsx';
import { METHOD_LABEL } from './PaymentPanel.jsx';
import { Empty, Feedback, Loading, PageHead, StatusBadge, useActions, useDebounced, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['report', 'Service report'],
  ['users', 'Users'],
  ['kyc', 'KYC reviews'],
  ['locations', 'Live locations'],
  ['emergency', 'Emergency'],
  ['payments', 'Payments'],
  ['disputes', 'Disputes'],
  ['fees', 'Fees and promos'],
  ['categories', 'Categories'],
  ['admins', 'Admins'],
  ['work', 'Work posts'],
  ['listings', 'Service listings'],
  ['reports', 'Reports'],
  ['contact', 'Contact inbox'],
];

export default function Admin() {
  const { user } = useAuth();
  const isMain = !!user.is_main_admin;
  const [tab, setTab] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    return TABS.some(([key]) => key === wanted) ? wanted : 'overview';
  });

  const { data: stats } = useLoad(async () => (await apiFetch('/admin/stats')).stats, [tab]);

  return (
    <div className="pg">
      <PageHead
        title="Admin panel"
        subtitle={isMain ? 'Signed in as the main admin. You can manage everything, including sub admins.' : 'Signed in as a sub admin. You can moderate users, content and reports.'}
      />

      <div className="tabs">
        {TABS.filter(([key]) => isMain || !['categories', 'admins'].includes(key)).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
            {label}
            {key === 'reports' && stats?.reports_open > 0 && <i>{stats.reports_open}</i>}
            {key === 'kyc' && stats?.kyc_pending > 0 && <i>{stats.kyc_pending}</i>}
            {key === 'payments' && stats?.payments_pending > 0 && <i>{stats.payments_pending}</i>}
            {key === 'disputes' && stats?.disputes_open > 0 && <i>{stats.disputes_open}</i>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview stats={stats} go={setTab} />}
      {tab === 'report' && <AdminReport />}
      {tab === 'users' && <Users />}
      {tab === 'kyc' && <KycReviews />}
      {tab === 'locations' && <AdminLocations />}
      {tab === 'emergency' && <AdminEmergency />}
      {tab === 'payments' && <AdminPayments />}
      {tab === 'disputes' && <AdminDisputes />}
      {tab === 'fees' && <AdminFees />}
      {tab === 'categories' && isMain && <Categories />}
      {tab === 'admins' && isMain && <AdminTeam />}
      {tab === 'work' && <Moderation kind="work" />}
      {tab === 'listings' && <Moderation kind="listings" />}
      {tab === 'reports' && <Reports />}
      {tab === 'contact' && <AdminContact />}
    </div>
  );
}

function BarChart({ title, subtitle, data, format = (value) => value, color = 'green' }) {
  const max = Math.max(1, ...data.map((point) => point.value));
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <section className="panel chart">
      <div className="card-row">
        <div>
          <h2>{title}</h2>
          <p className="sub" style={{ margin: 0 }}>
            {subtitle}
          </p>
        </div>
        <strong className="chart-total">{format(total)}</strong>
      </div>

      <div className="bars" role="img" aria-label={`${title}, last 14 days`}>
        {data.map((point, index) => (
          <div className="bar-col" key={point.date} title={`${point.date}: ${format(point.value)}`}>
            <span
              className={`bar ${color}`}
              style={{ height: `${Math.max(4, (point.value / max) * 100)}%`, animationDelay: `${index * 40}ms` }}
            />
            <small>{Number(point.date.slice(8))}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function Overview({ stats, go }) {
  const { user } = useAuth();
  const { data, loading } = useLoad(() => apiFetch('/admin/overview'));

  if (!stats) return <Loading />;

  const attention = [
    ['KYC submissions to review', stats.kyc_pending, 'kyc'],
    ['Open reports', stats.reports_open, 'reports'],
    ['Payments waiting for confirmation', stats.payments_pending, 'payments'],
    ['Open disputes', stats.disputes_open, 'disputes'],
    ['Online payouts to send', stats.payouts_due, 'payments'],
    ['Refunds to send', stats.refunds_due, 'payments'],
  ];
  const nothingPending = attention.every(([, count]) => !count);

  const cards = [
    ['Total users', stats.users, `${stats.seekers} seekers · ${stats.providers} providers`, 'users'],
    ['Work posts', stats.work_total, `${stats.work_open} open · ${stats.work_completed} completed`, 'work'],
    ['Service listings', stats.listings, 'Offered by providers', 'listings'],
    ['Paid volume', formatMoney(stats.payments_paid_total), 'Confirmed payments', 'payments'],
    ['Reviews', stats.reviews, 'Written by seekers'],
    ['Held in escrow', stats.escrow_held, `${formatMoney(stats.fees_collected)} service fees earned`, 'payments'],
    ['Bookings', stats.bookings, 'Direct bookings'],
    ['Applications', stats.applications, 'Sent to work posts'],
    ['Suspended', stats.banned, 'Accounts', 'users'],
  ];

  return (
    <>
      <section className="admin-welcome">
        <div>
          <span>ADMIN DASHBOARD</span>
          <h2>Welcome back, {user.full_name.split(' ')[0]}</h2>
          <p>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="admin-attention">
          <b>{nothingPending ? 'All clear' : 'Needs your attention'}</b>
          {nothingPending && <small>No pending reviews, reports or payments.</small>}
          {attention.map(
            ([label, count, target]) =>
              count > 0 && (
                <button key={label} onClick={() => go(target)}>
                  <i>{count}</i> {label}
                </button>
              )
          )}
        </div>
      </section>

      <div className="stats">
        {cards.map(([label, value, note, target], index) => (
          <div
            className={`stat ${index === 0 ? 'hero' : ''}`}
            key={label}
            style={target ? { cursor: 'pointer' } : undefined}
            onClick={() => target && go(target)}
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>

      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="admin-charts">
            <BarChart title="New users" subtitle="Last 14 days" data={data.charts.signups} />
            <BarChart title="Work posted" subtitle="Last 14 days" data={data.charts.work} color="teal" />
            <BarChart title="Bookings" subtitle="Last 14 days" data={data.charts.bookings} color="gold" />
            <BarChart
              title="Revenue confirmed"
              subtitle="Paid payments, last 14 days"
              data={data.charts.revenue}
              format={formatMoney}
            />
          </div>

          <div className="admin-columns">
            <section className="panel">
              <h2>Top categories</h2>
              <p className="sub">Most requested work.</p>
              {data.top_categories.length === 0 && <small>No work posted yet.</small>}
              {data.top_categories.map((category) => {
                const max = Math.max(...data.top_categories.map((item) => item.total));
                return (
                  <div className="hbar" key={category.name}>
                    <span>{category.name}</span>
                    <div>
                      <i style={{ width: `${(category.total / max) * 100}%` }} />
                    </div>
                    <b>{category.total}</b>
                  </div>
                );
              })}
            </section>

            <section className="panel">
              <h2>Work by status</h2>
              <p className="sub">Where every request stands.</p>
              <div className="status-chips">
                {data.work_by_status.map((row) => (
                  <span key={row.status}>
                    <StatusBadge status={row.status} /> <b>{row.total}</b>
                  </span>
                ))}
              </div>
            </section>
          </div>

          <div className="admin-columns three">
            <section className="panel">
              <div className="card-row">
                <h2>Newest users</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => go('users')}>
                  All
                </button>
              </div>
              {data.recent.users.map((item) => (
                <div className="feed" key={item.id}>
                  <b>{item.full_name}</b>
                  <small>
                    {item.role} · {formatDate(item.created_at)}
                  </small>
                  <StatusBadge status={item.kyc_status === 'none' ? 'inactive' : item.kyc_status} />
                </div>
              ))}
            </section>

            <section className="panel">
              <div className="card-row">
                <h2>Latest work</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => go('work')}>
                  All
                </button>
              </div>
              {data.recent.work.map((item) => (
                <div className="feed" key={item.id}>
                  <b>{item.title}</b>
                  <small>
                    {item.owner_name} · {formatMoney(item.budget)}
                  </small>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </section>

            <section className="panel">
              <div className="card-row">
                <h2>Latest payments</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => go('payments')}>
                  All
                </button>
              </div>
              {data.recent.payments.length === 0 && <small>No payments yet.</small>}
              {data.recent.payments.map((item) => (
                <div className="feed" key={item.id}>
                  <b>{formatMoney(item.amount)}</b>
                  <small>
                    {item.payer_name} · {METHOD_LABEL[item.method]}
                  </small>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Users() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const debounced = useDebounced(q);

  const { data, loading, error, reload } = useLoad(async () => {
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    if (role) params.set('role', role);
    return (await apiFetch(`/admin/users?${params}`)).users;
  }, [debounced, role]);

  const actions = useActions(() => reload(true));

  const update = (user, body, okMessage) =>
    actions.run(() => apiFetch(`/admin/users/${user.id}`, { method: 'PATCH', body }), okMessage);

  return (
    <>
      <div className="filters compact two">
        <label className="field">
          <span>Search users</span>
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Name or email" />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">All roles</option>
            <option value="seeker">Seekers</option>
            <option value="provider">Providers</option>
            <option value="admin">Admins</option>
          </select>
        </label>
      </div>

      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}

      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>NID</th>
                <th>Joined</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((user) => {
                const self = user.id === me.id;

                return (
                  <tr key={user.id}>
                    <td>
                      <b>{user.full_name}</b>
                      <small>{user.email}</small>
                    </td>
                    <td>
                      {user.role === 'admin' ? (
                        <span className="badge badge-info">{user.is_main_admin ? 'main admin' : 'sub admin'}</span>
                      ) : (
                        <select
                          value={user.role}
                          disabled={actions.busy || !me.is_main_admin}
                          onChange={(event) => update(user, { role: event.target.value }, 'Role updated.')}
                          aria-label={`Role for ${user.full_name}`}
                        >
                          <option value="seeker">seeker</option>
                          <option value="provider">provider</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {user.nid_number ? <small style={{ color: 'var(--mh-text)' }}>{user.nid_number}</small> : <small>Not submitted</small>}
                      <select
                        value={user.nid_status}
                        disabled={actions.busy}
                        onChange={(event) => update(user, { nid_status: event.target.value }, 'NID status updated.')}
                        aria-label={`NID status for ${user.full_name}`}
                      >
                        <option value="pending">pending</option>
                        <option value="verified">verified</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </td>
                    <td>{formatDate(user.created_at)}</td>
                    <td>{user.is_banned ? <span className="badge badge-danger">suspended</span> : <span className="badge">active</span>}</td>
                    <td>
                      <div className="actions">
                        <button
                          className={`btn btn-sm ${user.is_banned ? '' : 'btn-danger'}`}
                          disabled={self || actions.busy || user.is_main_admin || (user.role === 'admin' && !me.is_main_admin)}
                          onClick={() => {
                            const verb = user.is_banned ? 'Restore' : 'Suspend';
                            if (window.confirm(`${verb} ${user.full_name}?`)) {
                              update(user, { is_banned: !user.is_banned }, user.is_banned ? 'Account restored.' : 'Account suspended.');
                            }
                          }}
                        >
                          {user.is_banned ? 'Restore' : 'Suspend'}
                        </button>
                        {!self && (
                          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages/${user.id}`)}>
                            <Icon name="chat" /> Message
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.length === 0 && <Empty title="No users found" />}
        </div>
      )}
    </>
  );
}

function Categories() {
  const { data, loading, error, reload } = useLoad(async () => (await apiFetch('/admin/categories')).categories);
  const actions = useActions(reload);
  const [form, setForm] = useState({ id: null, name: '', description: '' });

  async function save(event) {
    event.preventDefault();

    const ok = await actions.run(
      () =>
        form.id
          ? apiFetch(`/admin/categories/${form.id}`, { method: 'PUT', body: form })
          : apiFetch('/admin/categories', { method: 'POST', body: form }),
      form.id ? 'Category updated.' : 'Category created.'
    );

    if (ok) setForm({ id: null, name: '', description: '' });
  }

  function remove(category) {
    if (!window.confirm(`Delete "${category.name}"?`)) return;
    actions.run(() => apiFetch(`/admin/categories/${category.id}`, { method: 'DELETE' }), 'Category deleted.');
  }

  return (
    <div className="detail">
      <div>
        <Feedback error={error || actions.error} notice={actions.notice} />
        {loading && !data && <Loading />}

        {data && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Used by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <b>{category.name}</b>
                      <small>{category.description}</small>
                    </td>
                    <td>{category.usage_count} post(s)</td>
                    <td>
                      <div className="actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            setForm({ id: category.id, name: category.name, description: category.description || '' })
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={category.usage_count > 0 || actions.busy}
                          title={category.usage_count > 0 ? 'In use' : 'Delete'}
                          onClick={() => remove(category)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="panel">
        <h2>{form.id ? 'Edit category' : 'New category'}</h2>
        <p className="sub">Categories group work posts and service listings.</p>
        <form className="form" onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={100} required />
          </label>
          <label className="field">
            <span>Description</span>
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={255} />
          </label>
          <div className="pg-actions">
            <button className="btn" disabled={actions.busy}>
              {form.id ? 'Save' : 'Add category'}
            </button>
            {form.id && (
              <button type="button" className="btn btn-ghost" onClick={() => setForm({ id: null, name: '', description: '' })}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function Moderation({ kind }) {
  const navigate = useNavigate();
  const isWork = kind === 'work';

  const { data, loading, error, reload } = useLoad(async () => {
    const result = await apiFetch(`/admin/${kind}`);
    return isWork ? result.work : result.listings;
  }, [kind]);

  const actions = useActions(reload);

  function toggle(item) {
    const hide = !item.is_hidden;
    if (hide && !window.confirm(`Hide "${item.title}"? The owner will be notified.`)) return;

    actions.run(
      () => apiFetch(`/admin/${kind}/${item.id}`, { method: 'PATCH', body: { is_hidden: hide } }),
      hide ? 'Hidden from the public.' : 'Restored.'
    );
  }

  return (
    <>
      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}

      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Owner</th>
                <th>{isWork ? 'Budget' : 'Price'}</th>
                <th>Status</th>
                <th>Posted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.title}</b>
                    <small>
                      {item.category_name || 'Other'} · {item.location}
                    </small>
                  </td>
                  <td>{item.owner_name}</td>
                  <td>{formatMoney(isWork ? item.budget : item.price)}</td>
                  <td>
                    {item.is_hidden ? <StatusBadge status="hidden" /> : <StatusBadge status={item.status} />}
                  </td>
                  <td>{formatDate(item.created_at)}</td>
                  <td>
                    <div className="actions">
                      {isWork && (
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/work/${item.id}`)}>
                          View
                        </button>
                      )}
                      <button
                        className={`btn btn-sm ${item.is_hidden ? '' : 'btn-danger'}`}
                        disabled={actions.busy}
                        onClick={() => toggle(item)}
                      >
                        {item.is_hidden ? 'Restore' : 'Hide'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <Empty title="Nothing here yet" />}
        </div>
      )}
    </>
  );
}

const TARGET_LABEL = { user: 'User', work: 'Work post', listing: 'Service listing' };

function Reports() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');

  const { data, loading, error, reload } = useLoad(
    async () => (await apiFetch(`/admin/reports?status=${status}`)).reports,
    [status]
  );
  const actions = useActions(reload);

  const resolve = (report, next) =>
    actions.run(
      () => apiFetch(`/admin/reports/${report.id}`, { method: 'PATCH', body: { status: next } }),
      `Report ${next}.`
    );

  // Quick moderation shortcut for the reported item, then close the report.
  async function takeAction(report) {
    const label = report.target_label || `#${report.target_id}`;

    if (report.target_type === 'user') {
      if (!window.confirm(`Suspend ${label}?`)) return;
      await actions.run(
        () => apiFetch(`/admin/users/${report.target_id}`, { method: 'PATCH', body: { is_banned: true } }),
        'User suspended.'
      );
    } else {
      if (!window.confirm(`Hide "${label}"?`)) return;
      const kind = report.target_type === 'work' ? 'work' : 'listings';
      await actions.run(
        () => apiFetch(`/admin/${kind}/${report.target_id}`, { method: 'PATCH', body: { is_hidden: true } }),
        'Content hidden.'
      );
    }

    await resolve(report, 'resolved');
  }

  return (
    <>
      <div className="tabs">
        {['open', 'resolved', 'dismissed'].map((key) => (
          <button key={key} className={`tab ${status === key ? 'on' : ''}`} onClick={() => setStatus(key)}>
            {key}
          </button>
        ))}
      </div>

      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}

      {data && data.length === 0 && <Empty title={`No ${status} reports`} text="Nothing needs your attention here." />}

      <div className="stack">
        {data?.map((report) => (
          <article className="card" key={report.id}>
            <div className="card-row">
              <div>
                <span className="badge badge-muted">{TARGET_LABEL[report.target_type]}</span>{' '}
                <b>{report.target_label || 'Deleted item'}</b>
              </div>
              <StatusBadge status={report.status} />
            </div>

            <div className="quote">{report.reason}</div>
            <small style={{ color: 'var(--mh-muted)' }}>
              Reported by {report.reporter_name} on {formatDate(report.created_at)}
            </small>

            {report.status === 'open' && (
              <div className="card-actions">
                {report.target_type === 'work' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/work/${report.target_id}`)}>
                    View
                  </button>
                )}
                {report.target_label && (
                  <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={() => takeAction(report)}>
                    {report.target_type === 'user' ? 'Suspend user' : 'Hide content'}
                  </button>
                )}
                <button className="btn btn-sm" disabled={actions.busy} onClick={() => resolve(report, 'resolved')}>
                  Mark resolved
                </button>
                <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => resolve(report, 'dismissed')}>
                  Dismiss
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function KycReviews() {
  const [status, setStatus] = useState('pending');

  const { data, loading, error, reload } = useLoad(
    async () => (await apiFetch(`/admin/kyc?status=${status}`)).users,
    [status]
  );
  const actions = useActions(reload);

  function approve(user) {
    if (!window.confirm(`Verify ${user.full_name}? Check that the NID and selfie match.`)) return;
    actions.run(
      () => apiFetch(`/admin/kyc/${user.id}`, { method: 'PATCH', body: { status: 'verified' } }),
      'User verified.'
    );
  }

  function reject(user) {
    const reason = window.prompt('Why is it rejected? (shown to the user)', 'Photo is not clear.');
    if (!reason) return;
    actions.run(
      () => apiFetch(`/admin/kyc/${user.id}`, { method: 'PATCH', body: { status: 'rejected', reason } }),
      'Submission rejected.'
    );
  }

  return (
    <>
      <div className="tabs">
        {['pending', 'verified', 'rejected'].map((key) => (
          <button key={key} className={`tab ${status === key ? 'on' : ''}`} onClick={() => setStatus(key)}>
            {key}
          </button>
        ))}
      </div>

      <Feedback error={error || actions.error} notice={actions.notice} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title={`No ${status} submissions`} text="Nothing to review here." />}

      <div className="stack">
        {data?.map((user) => (
          <article className="card" key={user.id}>
            <div className="card-row">
              <div>
                <b>{user.kyc_full_name || user.full_name}</b>{' '}
                <span className="badge badge-muted">{user.role}</span>
                <br />
                <small style={{ color: 'var(--mh-muted)' }}>
                  {user.email} · account name: {user.full_name}
                </small>
              </div>
              <StatusBadge status={user.kyc_status} />
            </div>

            <div className="meta">
              <span>
                {user.kyc_method === 'birth_certificate' ? 'Birth certificate' : 'NID'}: <b>{user.kyc_method === 'birth_certificate' ? user.birth_cert_number : user.nid_number}</b>
              </span>
              {user.kyc_method === 'birth_certificate' && <span className="badge badge-warn">Under 18</span>}
              <span>
                Date of birth: <b>{formatDate(user.kyc_dob)}</b>
              </span>
              <span>Submitted {formatDate(user.kyc_submitted_at)}</span>
            </div>

            <div className="kyc-docs">
              {user.kyc_method === 'birth_certificate' ? (
                <KycDocument userId={user.id} type="birth_certificate" label="Birth certificate" />
              ) : (
                <>
                  <KycDocument userId={user.id} type="nid_front" label="NID front" />
                  <KycDocument userId={user.id} type="nid_back" label="NID back" />
                </>
              )}
              <KycDocument userId={user.id} type="selfie" label="Selfie" />
            </div>

            {user.kyc_reason && <div className="alert">Rejected: {user.kyc_reason}</div>}

            {user.kyc_status === 'pending' && (
              <div className="card-actions">
                <button className="btn btn-sm" disabled={actions.busy} onClick={() => approve(user)}>
                  Approve
                </button>
                <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={() => reject(user)}>
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function AdminTeam() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useLoad(() => apiFetch('/admin/admins'));
  const actions = useActions(reload);

  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);

  const { data: candidates } = useLoad(async () => {
    if (query.length < 2) return null;
    const result = await apiFetch(`/admin/users?q=${encodeURIComponent(query)}`);
    return result.users.filter((person) => person.role !== 'admin' && !person.is_banned).slice(0, 8);
  }, [query]);

  async function add(email, question) {
    if (!window.confirm(question)) return;
    const ok = await actions.run(() => apiFetch('/admin/admins', { method: 'POST', body: { email } }));
    if (ok) setSearch('');
  }

  function remove(admin) {
    if (!window.confirm(`Remove admin access from ${admin.full_name}? They become a normal seeker account.`)) return;
    actions.run(() => apiFetch(`/admin/admins/${admin.id}`, { method: 'DELETE' }), 'Admin access removed.');
  }

  function cancelInvite(invite) {
    actions.run(() => apiFetch(`/admin/invites/${invite.id}`, { method: 'DELETE' }), 'Invitation cancelled.');
  }

  const exactMatch = candidates?.some((person) => person.email.toLowerCase() === query.toLowerCase());
  const admins = data?.admins || [];
  const invites = data?.invites || [];

  return (
    <div className="detail side-wide">
      <div className="stack">
        <Feedback error={error || actions.error} notice={actions.notice} />
        {loading && !data && <Loading />}

        {data && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Admin team</th>
                  <th>Role</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>
                      <b>
                        {admin.full_name} {admin.id === me.id && <span className="badge badge-muted">you</span>}
                      </b>
                      <small>{admin.email}</small>
                    </td>
                    <td>
                      {admin.is_main_admin ? (
                        <span className="badge badge-warn">Main admin</span>
                      ) : (
                        <span className="badge badge-info">Sub admin</span>
                      )}
                    </td>
                    <td>
                      {admin.is_main_admin ? (
                        <small>Cannot be changed</small>
                      ) : (
                        <button className="btn btn-danger btn-sm" disabled={actions.busy} onClick={() => remove(admin)}>
                          Remove access
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {invites.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pending invitations</th>
                  <th>Invited by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>
                      <b>{invite.email}</b>
                      <small>Becomes a sub admin after they sign up and verify this email</small>
                    </td>
                    <td>{invite.invited_by}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" disabled={actions.busy} onClick={() => cancelInvite(invite)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="panel">
        <h2>Add a sub admin</h2>
        <p className="sub">Pick a registered user, or type any email address to invite someone who has not signed up yet.</p>

        <label className="field">
          <span>Name or email</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users or enter an email" autoComplete="off" />
        </label>

        <div className="picker">
          {query.length < 2 && <small>Type at least 2 letters.</small>}
          {query.length >= 2 && !candidates && <small>Searching...</small>}

          {candidates?.map((person) => (
            <div className="picker-row" key={person.id}>
              <div>
                <b>{person.full_name}</b>
                <small>
                  {person.email} · {person.role}
                </small>
              </div>
              <button
                className="btn btn-sm"
                disabled={actions.busy}
                onClick={() => add(person.email, `Make ${person.full_name} a sub admin?`)}
              >
                Make sub admin
              </button>
            </div>
          ))}

          {candidates && candidates.length === 0 && !isEmail && <small>No matching users. Type a full email address to invite someone new.</small>}

          {isEmail && !exactMatch && (
            <div className="picker-row">
              <div>
                <b>{query}</b>
                <small>Not registered yet. We will email an invitation.</small>
              </div>
              <button
                className="btn btn-sm"
                disabled={actions.busy}
                onClick={() => add(query, `Invite ${query} to join as a sub admin?`)}
              >
                Invite as sub admin
              </button>
            </div>
          )}
        </div>

        <ul className="faq" style={{ marginTop: 16 }}>
          <li>
            <b>Sub admin:</b> reviews NID verification, handles reports, hides content, suspends users and answers support chats.
          </li>
          <li>
            <b>Main admin (you):</b> everything above, plus categories, roles and choosing sub admins. Nobody else can change the main admin.
          </li>
        </ul>
      </section>
    </div>
  );
}
