import { useState } from 'react';
import { apiFetch, formatMoney } from './api.js';
import { Feedback, Loading, PageHead, useLoad } from './ui.jsx';

export default function Referrals() {
  const { data, loading, error } = useLoad(() => apiFetch('/referrals/me'));
  const [copied, setCopied] = useState('');

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      setCopied('');
    }
  }

  const link = data ? `${window.location.origin}/register?ref=${data.referral_code}` : '';

  return (
    <div className="pg pg-narrow">
      <PageHead title="Invite friends" subtitle="Share your code. Friends get a welcome discount, and you get a reward after their first online payment." />

      <Feedback error={error} />
      {loading && !data && <Loading />}

      {data && (
        <>
          <section className="panel referral-card">
            <span className="eyebrow">Your referral code</span>
            <div className="referral-code">{data.referral_code}</div>
            <div className="card-actions">
              <button className="btn btn-sm" onClick={() => copy(data.referral_code)}>{copied === data.referral_code ? 'Copied!' : 'Copy code'}</button>
              <button className="btn btn-soft btn-sm" onClick={() => copy(link)}>{copied === link ? 'Copied!' : 'Copy invite link'}</button>
            </div>
            <p className="quote">
              {data.bonus > 0
                ? `Each of you saves ${formatMoney(data.bonus)} on an online payment.`
                : 'Referral rewards are not running right now, but your code stays valid.'}{' '}
              You have invited <b>{data.invited}</b> {data.invited === 1 ? 'person' : 'people'}.
            </p>
          </section>

          <section className="panel">
            <h2>My promo codes</h2>
            {data.promos.length === 0 && <p className="quote">You do not have any codes yet. Enter one on the payment screen when you pay online.</p>}
            <div className="promo-list">
              {data.promos.map((promo) => {
                const used = promo.used_count >= (promo.max_uses ?? Infinity);
                return (
                  <div className={`promo-item ${used || !promo.active ? 'is-used' : ''}`} key={promo.code}>
                    <div>
                      <b>{promo.code}</b>
                      <small>{promo.kind === 'percent' ? `${Number(promo.value)}% off` : `${formatMoney(promo.value)} off`}</small>
                    </div>
                    <span className="badge badge-muted">{used ? 'Used' : promo.active ? 'Ready to use' : 'Off'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
