import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';
import { Feedback, Loading, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

const HELPLINES = [
  ['999', 'National Emergency Service', 'Police, fire and ambulance. Call this first in danger.'],
  ['16263', 'Health Call Centre', 'Free health advice from doctors by phone, any time.'],
  ['109', 'Women and Children Helpline', 'Help for anyone facing violence or abuse.'],
];

/** Emergency help in one place: call 999, find an ambulance or an online doctor, or get blood. */
export default function Emergency() {
  const navigate = useNavigate();
  const { data, loading, error } = useLoad(() => apiFetch('/emergency'));

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div className="em">
      <header className="em-hero">
        <div>
          <h1>Emergency help</h1>
          <p>Fast help when every minute counts.</p>
        </div>
        <a className="em-call" href="tel:999">
          <span aria-hidden="true"><Icon name="phone" /></span>
          <span>
            <b>Call 999</b>
            <small>National emergency service</small>
          </span>
        </a>
      </header>

      <div className="em-body">
        <p className="em-warning">
          <b>In danger, or if someone's life is at risk, call 999 first.</b> The services below help you right after, or when it is urgent but not life-threatening.
        </p>

        <Feedback error={error} />
        {loading && !data && <Loading text="Loading..." variant="cards" />}

        <div className="em-grid">
          <article className="em-card em-ambulance">
            <span className="em-ico" aria-hidden="true"><Icon name="ambulance" /></span>
            <h2>Ambulance</h2>
            <p>Ambulance and patient transport, day and night.</p>
            <small>
              {data ? (data.ambulance.total ? `${data.ambulance.available} of ${plural(data.ambulance.total, 'ambulance')} available now` : 'No ambulance added yet') : ' '}
            </small>
            <div className="em-actions">
              <button className="btn" onClick={() => navigate('/emergency/ambulances')}>
                Choose an ambulance
              </button>
            </div>
          </article>

          <article className="em-card em-doctor">
            <span className="em-ico" aria-hidden="true"><Icon name="doctor" /></span>
            <h2>Online doctor</h2>
            <p>Ask for a checkup. An admin approves it and sends you the meeting link. Not for emergencies.</p>
            <small>{data ? (data.doctor.listings ? plural(data.doctor.listings, 'doctor') + ' available' : 'No doctor added yet') : ' '}</small>
            <div className="em-actions">
              <button className="btn" onClick={() => navigate('/emergency/doctors')}>
                Ask for a checkup
              </button>
            </div>
          </article>

          <article className="em-card em-blood">
            <span className="em-ico" aria-hidden="true"><Icon name="drop" /></span>
            <h2>Blood bank</h2>
            <p>Find donors near you, ask for blood, or become a donor.</p>
            <small>
              {data ? `${plural(data.blood.donors, 'donor')} · ${plural(data.blood.open_requests, 'open request')}` : ' '}
            </small>
            <div className="em-actions">
              <button className="btn" onClick={() => navigate('/blood?tab=donors')}>
                Find donors
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/blood?tab=requests')}>
                Ask for blood
              </button>
            </div>
          </article>
        </div>

        <h2 className="em-title">Helplines</h2>
        <div className="em-lines">
          {HELPLINES.map(([number, name, text]) => (
            <a key={number} className="em-line" href={`tel:${number}`}>
              <span className="em-number">{number}</span>
              <span>
                <b>{name}</b>
                <small>{text}</small>
              </span>
              <span className="em-dial" aria-hidden="true">Call</span>
            </a>
          ))}
        </div>

        <p className="hint" style={{ marginTop: 18 }}>
          Doctors on MicroServiceHub give advice by an online meeting. They cannot treat an emergency, so for chest pain, heavy bleeding, trouble breathing or a serious
          accident, call 999 or go to the nearest hospital.
        </p>
      </div>
    </div>
  );
}
