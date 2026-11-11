import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, closesIn, formatMoney } from './api.js';
import { useAuth } from './auth.jsx';
import { CategoryIcon, toneFor } from './categoryIcons.jsx';
import { Thumb } from './Photos.jsx';
import { Empty, Feedback, Loading, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** A small card for a listing: picture or icon, title, who offers it, and the price. */
export function ListingRow({ item, onOpen }) {
  return (
    <button type="button" className="ex-row" onClick={() => onOpen(item)}>
      <span className="ex-row-pic">
        {item.image_id ? <Thumb imageId={item.image_id} label={item.title} /> : <CategoryIcon name={item.category_name} />}
      </span>
      <span className="ex-row-text">
        <b>{item.title}</b>
        <small>
          {item.provider_name}
          {item.credential ? ` · ${item.credential}` : item.category_name ? ` · ${item.category_name}` : ''}
        </small>
        {item.description && <small className="ex-desc">{item.description}</small>}
      </span>
      <span className="ex-price">{formatMoney(item.price)}</span>
    </button>
  );
}

/** A job somebody posted: tap it to read it (and apply, if you are a provider). */
export function JobRow({ job, onOpen }) {
  const left = closesIn(job.expires_at);
  return (
    <button type="button" className="ex-row" onClick={() => onOpen(job)}>
      <span className="ex-row-pic">
        {job.image_id ? <Thumb imageId={job.image_id} label={job.title} /> : <CategoryIcon name={job.category_name} />}
      </span>
      <span className="ex-row-text">
        <b>{job.title}</b>
        <small>
          {job.location} · by {job.seeker_name}
          {left ? ` · ${left}` : ''}
        </small>
      </span>
      <span className="ex-price">{formatMoney(job.budget)}</span>
    </button>
  );
}

/** The front door for seekers: every service type as a tile, bookings at hand, and what is popular. */
export default function Explore() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { data, loading, error } = useLoad(() => apiFetch('/explore'));

  const categories = data?.categories || [];
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => (term ? categories.filter((c) => c.name.toLowerCase().includes(term)) : categories), [categories, term]);

  // A clean first screen: the twelve busiest service types, with the rest one tap away.
  const FIRST = 12;
  const visible = term || showAll ? shown : shown.slice(0, FIRST);

  function search(event) {
    event.preventDefault();
    if (!term) return;
    if (shown.length === 1) navigate(`/explore/${shown[0].id}`);
    else navigate(`/provider-services?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className="ex">
      <header className="ex-hero">
        <div className="ex-hero-top">
          <span className="ex-hero-badge" aria-hidden="true"><Icon name="compass" /></span>
          <div>
            <h1>All services</h1>
            <p>{categories.length ? `${categories.length} service types · one account` : 'Find help for everyday needs'}</p>
          </div>
        </div>

        <form className="ex-search" onSubmit={search} role="search">
          <span aria-hidden="true"><Icon name="search" /></span>
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search services, e.g. plumbing" aria-label="Search services" />
          {q && (
            <button type="button" className="ex-clear" onClick={() => setQ('')} aria-label="Clear search">
              <Icon name="x" />
            </button>
          )}
        </form>
      </header>

      <div className="ex-body">
        <Feedback error={error} />

        {user.role !== 'admin' && (
          <button type="button" className="ex-sos" onClick={() => navigate('/emergency')}>
            <span aria-hidden="true"><Icon name="siren" /></span>
            <span>
              <b>Emergency help</b>
              <small>Ambulance · Online doctor · Blood bank</small>
            </span>
            <span className="ex-chevron" aria-hidden="true">›</span>
          </button>
        )}

        {user.role === 'seeker' && (
          <button type="button" className="ex-booking" onClick={() => navigate('/my-bookings')}>
            <span className="ex-booking-ico" aria-hidden="true"><Icon name="calendar" /></span>
            <span>
              <b>My bookings</b>
              <small>
                {data?.my_active_bookings
                  ? `${data.my_active_bookings} active ${data.my_active_bookings === 1 ? 'booking' : 'bookings'}`
                  : 'Track your service bookings'}
              </small>
            </span>
            <span className="ex-chevron" aria-hidden="true">›</span>
          </button>
        )}

        <div className="ex-title">
          <h2>What do you need?</h2>
          <button type="button" className="ex-link" onClick={() => navigate('/provider-services')}>
            See all →
          </button>
        </div>

        {loading && !data && <Loading text="Loading services..." variant="cards" />}

        {data && shown.length === 0 && (
          <Empty
            title="No service type matches"
            text={`Try another word, or search all listings for "${q.trim()}".`}
            action={
              <button className="btn" onClick={() => navigate(`/provider-services?q=${encodeURIComponent(q.trim())}`)}>
                Search listings
              </button>
            }
          />
        )}

        <div className="ex-grid">
          {visible.map((c, index) => {
            const tone = toneFor(index);
            return (
              <button
                key={c.id}
                type="button"
                className="ex-tile"
                style={{ '--tile-bg': tone.bg, '--tile-chip': tone.chip, '--tile-glow': tone.glow, '--tile-fg': tone.fg }}
                onClick={() => navigate(c.name === 'Ambulance' ? '/emergency/ambulances' : c.name === 'Online Doctor' ? '/emergency/doctors' : `/explore/${c.id}`)}
              >
                <span className="ex-ico" aria-hidden="true"><CategoryIcon name={c.name} /></span>
                <b>{c.name}</b>
                <small>{[c.listings > 0 && (c.admin_run ? `${c.listings} available` : `${c.listings} ${c.listings === 1 ? 'offer' : 'offers'}`), c.open_work > 0 && `${c.open_work} ${c.open_work === 1 ? 'job' : 'jobs'}`].filter(Boolean).join(' · ') || 'No offers yet'}</small>
              </button>
            );
          })}
        </div>

        {!term && shown.length > FIRST && (
          <button type="button" className="ex-more" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show fewer' : `Show all ${shown.length} services`}
          </button>
        )}

        {data?.popular?.length > 0 && !term && (
          <>
            <div className="ex-title">
              <h2>Popular this week</h2>
            </div>
            <div className="ex-list">
              {data.popular.map((item) => (
                <ListingRow key={item.id} item={item} onOpen={(it) => (user.role === 'seeker' ? navigate(`/provider-services?open=${it.id}`) : navigate(`/providers/${it.provider_id}`))} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
