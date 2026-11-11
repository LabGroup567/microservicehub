import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * A short "what to do next" list for new accounts. It disappears once everything is done,
 * and people can hide it themselves.
 */
export default function GettingStarted({ user, overview }) {
  const navigate = useNavigate();
  const key = `microservicehub-hide-start-${user.id}`;

  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  if (!overview || hidden) return null;

  const verified = user.kyc_status === 'verified';
  const pendingReview = user.kyc_status === 'pending';
  const isProvider = user.role === 'provider';

  const steps = isProvider
    ? [
        {
          done: verified,
          title: 'Verify your identity',
          text: pendingReview ? 'Submitted. An admin is reviewing it.' : 'Upload your NID (or birth certificate if you are under 18) and a selfie. You need this to apply, list services and get paid.',
          action: pendingReview ? null : ['Verify now', '/kyc'],
        },
        {
          done: Number(overview.listings) > 0,
          title: 'List a service',
          text: 'Tell customers what you offer and your price, so they can book you directly.',
          action: ['Add a service', '/my-services'],
        },
        {
          done: Number(overview.total_applications) > 0 || Number(overview.active_bookings) > 0,
          title: 'Find your first job',
          text: 'Browse open work near you and apply with a short message.',
          action: ['Find work', '/services'],
        },
      ]
    : [
        {
          done: verified,
          title: 'Verify your identity',
          text: pendingReview ? 'Submitted. An admin is reviewing it.' : 'Upload your NID (or birth certificate if you are under 18) and a selfie. It keeps everyone safe.',
          action: pendingReview ? null : ['Verify now', '/kyc'],
        },
        {
          done: Number(overview.total_work) > 0,
          title: 'Post your first work',
          text: 'Describe what you need. Providers will apply and you choose who to hire.',
          action: ['Post work', '/add-work'],
        },
        {
          done: Number(overview.active_bookings) > 0 || Number(overview.completed_work) > 0,
          title: 'Or book a provider directly',
          text: 'Browse services, pick a day from the calendar and send a booking request.',
          action: ['Find providers', '/provider-services'],
        },
      ];

  const finished = steps.filter((step) => step.done).length;
  if (finished === steps.length) return null;

  function hide() {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // It will simply show again next time.
    }
    setHidden(true);
  }

  return (
    <section className="start" aria-label="Getting started">
      <div className="start-head">
        <div>
          <h2>Get started</h2>
          <p>{finished} of {steps.length} done</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={hide}>Hide</button>
      </div>

      <div className="start-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={finished}>
        <span style={{ width: `${(finished / steps.length) * 100}%` }} />
      </div>

      <ol className="start-steps">
        {steps.map((step, index) => (
          <li key={step.title} className={step.done ? 'is-done' : ''}>
            <span className="start-mark" aria-hidden="true">{step.done ? <Icon name="check" /> : index + 1}</span>
            <div>
              <b>{step.title}</b>
              <p>{step.text}</p>
            </div>
            {!step.done && step.action && (
              <button type="button" className="btn btn-sm" onClick={() => navigate(step.action[1])}>{step.action[0]}</button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
