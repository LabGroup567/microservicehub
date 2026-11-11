import { apiFetch, formatDate, formatMoney } from './api.js';
import { Empty, Feedback, Loading, PageHead, StatusBadge, useLoad } from './ui.jsx';

function describe(payment) {
  if (payment.status === 'pending') return 'Waiting for you to confirm';
  if (payment.status === 'refunded') return 'Refunded to the seeker';
  if (payment.gateway) {
    if (payment.escrow_status === 'held') return 'Held until the job is confirmed';
    if (payment.escrow_status === 'disputed') return 'On hold: dispute open';
    if (payment.payout_status === 'due') return 'Released, payout on its way';
    if (payment.payout_status === 'paid_out') return 'Paid out to your bKash';
  }
  return 'Received';
}

export default function Earnings() {
  const { data, loading, error } = useLoad(() => apiFetch('/provider/earnings'));

  const max = Math.max(1, ...(data?.months.map((month) => month.total) || [0]));
  const cards = data
    ? [
        ['Received', data.totals.received, 'Money you have been paid', true],
        ['Waiting for your confirmation', data.totals.to_confirm, 'Confirm when you get it'],
        ['Held safely', data.totals.in_escrow, 'Released after the job is confirmed'],
        ['Payout on its way', data.totals.payout_due, 'Sent to your bKash soon'],
      ]
    : [];

  return (
    <div className="pg">
      <PageHead title="My earnings" subtitle="What you have earned, and what is still on its way." />

      <Feedback error={error} />
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="stats">
            {cards.map(([label, value, note, hero]) => (
              <div className={`stat ${hero ? 'hero' : ''}`} key={label}>
                <span>{label}</span>
                <strong>{formatMoney(value)}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>

          <section className="panel">
            <h2>Last 6 months</h2>
            <div className="earn-chart" role="img" aria-label="Money received in each of the last six months">
              {data.months.map((month) => (
                <div className="earn-col" key={month.month}>
                  <span className="earn-value">{month.total ? formatMoney(month.total) : ''}</span>
                  <div className="earn-bar"><i style={{ height: `${Math.max(month.total ? 6 : 0, (month.total / max) * 100)}%` }} /></div>
                  <b>{month.label}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Recent payments</h2>
            {data.recent.length === 0 && <Empty title="No payments yet" text="Your payments will show here once customers pay you." />}
            {data.recent.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>For</th><th>From</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {data.recent.map((payment) => (
                      <tr key={payment.id}>
                        <td><b>{payment.title}</b></td>
                        <td>{payment.payer_name}</td>
                        <td>{formatMoney(payment.amount)}</td>
                        <td><StatusBadge status={payment.status} /><small>{describe(payment)}</small></td>
                        <td>{formatDate(payment.happened_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
