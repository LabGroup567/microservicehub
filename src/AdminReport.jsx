import { useState } from 'react';
import { API, apiFetch, formatMoney, readSession } from './api.js';
import { Empty, Feedback, Loading, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const RANGES = [
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [365, 'Last year'],
  [0, 'All time'],
];

/** How each service type is doing, with a one-click spreadsheet. */
export default function AdminReport() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const { data, loading, error } = useLoad(() => apiFetch(`/admin/report?days=${days}`), [days]);

  async function download() {
    setBusy(true);
    setDownloadError('');
    try {
      const response = await fetch(`${API}/admin/report.csv?days=${days}`, {
        headers: { Authorization: `Bearer ${readSession()?.token}` },
      });
      if (!response.ok) throw new Error('Could not create the file. Please try again.');

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `microservicehub-report-${days === 0 ? 'all-time' : `last-${days}-days`}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totals = data?.totals;
  const rows = (data?.categories || []).filter((row) => row.posted || row.bookings);
  const quiet = (data?.categories || []).length - rows.length;
  const topPosted = Math.max(1, ...rows.map((row) => row.posted));

  return (
    <div className="stack">
      <section className="panel">
        <div className="card-row">
          <div>
            <h2 style={{ margin: 0 }}>Service report</h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              Which services people ask for, how many get hired and finished, and how much work is worth.
            </p>
          </div>
          <button className="btn" onClick={download} disabled={busy || loading}>
            {busy ? 'Preparing...' : <><Icon name="download" /> Download CSV</>}
          </button>
        </div>

        <div className="tabs" style={{ marginTop: 16 }}>
          {RANGES.map(([value, label]) => (
            <button key={value} className={`tab ${days === value ? 'on' : ''}`} onClick={() => setDays(value)}>
              {label}
            </button>
          ))}
        </div>

        <Feedback error={error || downloadError} />
        {loading && !data && <Loading text="Building the report..." />}
      </section>

      {totals && (
        <div className="stats">
          <div className="stat"><span>New members</span><strong>{totals.signups}</strong></div>
          <div className="stat"><span>Work posted</span><strong>{totals.posted}</strong></div>
          <div className="stat"><span>Hired</span><strong>{totals.hired}</strong></div>
          <div className="stat"><span>Completed</span><strong>{totals.completed}</strong></div>
          <div className="stat"><span>Bookings</span><strong>{totals.bookings}</strong></div>
          <div className="stat"><span>Completed work value</span><strong>{formatMoney(totals.completed_value)}</strong></div>
          <div className="stat"><span>Payments received</span><strong>{formatMoney(totals.paid)}</strong></div>
          <div className="stat"><span>Platform fees</span><strong>{formatMoney(totals.fees)}</strong></div>
        </div>
      )}

      {data && (
        <section className="panel">
          <h2>By service type</h2>
          {rows.length === 0 ? (
            <Empty title="Nothing in this period" text="Try a longer range." />
          ) : (
            <div className="table-wrap">
              <table className="table rep-table">
                <thead>
                  <tr>
                    <th>Service type</th>
                    <th>Posted</th>
                    <th>Hired</th>
                    <th>Completed</th>
                    <th>Cancelled</th>
                    <th>Open</th>
                    <th>Avg budget</th>
                    <th>Completed value</th>
                    <th>Bookings</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <strong>{row.name}</strong>
                        <div className="rep-bar" aria-hidden="true">
                          <i style={{ width: `${Math.round((row.posted / topPosted) * 100)}%` }} />
                        </div>
                      </td>
                      <td>{row.posted}</td>
                      <td>{row.hired}</td>
                      <td>{row.completed}</td>
                      <td>{row.cancelled}</td>
                      <td>{row.still_open}</td>
                      <td>{row.avg_budget ? formatMoney(row.avg_budget) : '-'}</td>
                      <td>{row.completed_value ? formatMoney(row.completed_value) : '-'}</td>
                      <td>{row.bookings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {quiet > 0 && <p className="hint">{quiet} service types had no activity in this period.</p>}
        </section>
      )}
    </div>
  );
}
