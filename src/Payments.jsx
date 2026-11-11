import { useNavigate } from 'react-router-dom';
import { apiFetch, formatDate, formatMoney } from './api.js';
import { useAuth } from './auth.jsx';
import { METHOD_LABEL } from './PaymentPanel.jsx';
import { Empty, Feedback, Loading, PageHead, StatusBadge, useLoad } from './ui.jsx';

export default function Payments() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useLoad(async () => (await apiFetch('/payments/mine')).payments);

  const payments = data || [];
  const sum = (test) => payments.filter(test).reduce((total, p) => total + Number(p.amount), 0);

  const received = sum((p) => p.payee_id === user.id && p.status === 'paid');
  const pendingIn = sum((p) => p.payee_id === user.id && p.status === 'pending');
  const spent = sum((p) => p.payer_id === user.id && p.status === 'paid');

  return (
    <div className="pg">
      <PageHead title="Payments" subtitle="Cash, bKash and Nagad payments for your work and bookings." />

      <Feedback error={error} />

      <div className="stats">
        {user.role === 'provider' ? (
          <>
            <div className="stat hero">
              <span>Received</span>
              <strong>{formatMoney(received)}</strong>
            </div>
            <div className="stat">
              <span>Waiting to confirm</span>
              <strong>{formatMoney(pendingIn)}</strong>
            </div>
          </>
        ) : (
          <div className="stat hero">
            <span>Total paid</span>
            <strong>{formatMoney(spent)}</strong>
          </div>
        )}
        <div className="stat">
          <span>Transactions</span>
          <strong>{payments.length}</strong>
        </div>
      </div>

      {loading && !data && <Loading />}

      {data && payments.length === 0 && (
        <Empty
          title="No payments yet"
          text={
            user.role === 'provider'
              ? 'Payments appear here when a customer pays you.'
              : 'After hiring a provider or accepting a booking you can pay from the work or booking page.'
          }
        />
      )}

      {payments.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>For</th>
                <th>{user.role === 'provider' ? 'From' : 'To'}</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr
                  key={payment.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(payment.service_id ? `/work/${payment.service_id}` : user.role === 'provider' ? '/provider-bookings' : '/my-bookings')}
                >
                  <td>
                    <b>{payment.title}</b>
                    {payment.trx_id && <small>TrxID {payment.trx_id}</small>}
                  </td>
                  <td>{payment.payer_id === user.id ? payment.payee_name : payment.payer_name}</td>
                  <td>{METHOD_LABEL[payment.method]}</td>
                  <td>{formatMoney(payment.amount)}</td>
                  <td>
                    <StatusBadge status={payment.status} />
                  </td>
                  <td>{formatDate(payment.paid_at || payment.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
