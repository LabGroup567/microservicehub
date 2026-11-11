import { useEffect, useRef, useState } from 'react';
import Calendar from './Calendar.jsx';
import { Thumb } from './Photos.jsx';
import { HeartButton } from './Favorites.jsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BrowseTabs from './BrowseTabs.jsx';
import { useAuth } from './auth.jsx';
import { apiFetch, formatMoney } from './api.js';
import Icon from './Icon.jsx';
import {
  Empty,
  Feedback,
  Loading,
  Modal,
  PageHead,
  ReportDialog,
  useActions,
  useDebounced,
  useLoad,
} from './ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function ProviderServices() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSeeker = user.role === 'seeker';

  const BLANK_FILTERS = { q: '', location: '', category_id: '', min_price: '', max_price: '', available_on: '', verified: '', sort: 'newest' };
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ ...BLANK_FILTERS, category_id: params.get('category_id') || '', q: params.get('q') || '' });
  const [showMore, setShowMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [booking, setBooking] = useState({ date: '', message: '' });
  const [report, setReport] = useState(null);

  const applied = useDebounced(filters);

  const { data: categories } = useLoad(async () => (await apiFetch('/categories')).categories);
  const { data, loading, error, reload } = useLoad(async () => {
    const params = new URLSearchParams();
    Object.entries(applied).forEach(([key, value]) => value && params.set(key, value));
    return (await apiFetch(`/provider-services?${params}`)).services;
  }, [applied]);

  const actions = useActions();

  // Coming from Explore with ?open=ID: open that offer straight away so the seeker can book it.
  const openId = Number(params.get('open')) || 0;
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!openId || openedOnce.current || !data) return;
    const found = data.find((service) => service.id === openId);
    if (!found) return;
    openedOnce.current = true;
    if (isSeeker) setSelected(found);
  }, [data, openId, isSeeker]);

  // Days the chosen provider cannot work, shown in the booking calendar.
  const { data: calendar } = useLoad(
    async () => (selected ? await apiFetch(`/availability/${selected.provider_id}`) : null),
    [selected?.provider_id]
  );

  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));

  async function book(event) {
    event.preventDefault();

    const ok = await actions.run(
      () =>
        apiFetch('/bookings', {
          method: 'POST',
          body: {
            provider_service_id: selected.id,
            preferred_date: booking.date,
            message: booking.message,
          },
        }),
      'Booking request sent. The provider has been notified.'
    );

    if (ok) {
      setSelected(null);
      setBooking({ date: '', message: '' });
    }
  }

  function openBooking(service) {
    actions.setError('');
    setSelected(service);
  }

  return (
    <div className="pg">
      <PageHead title="Find providers" subtitle="Browse services offered by providers and book the one you like.">
        <button className="btn btn-ghost" onClick={() => navigate('/nearby')}>
          <Icon name="map" /> Who is available now
        </button>
      </PageHead>

      <BrowseTabs active="offers" />

      <div className="filters compact">
        <label className="field">
          <span>Search</span>
          <input value={filters.q} onChange={set('q')} placeholder="e.g. cleaning, repair" />
        </label>
        <label className="field">
          <span>Location</span>
          <input value={filters.location} onChange={set('location')} placeholder="e.g. Dhanmondi" />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={filters.category_id} onChange={set('category_id')}>
            <option value="">All categories</option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sort by</span>
          <select value={filters.sort} onChange={set('sort')}>
            <option value="newest">Newest</option>
            <option value="price_low">Price: low to high</option>
            <option value="price_high">Price: high to low</option>
          </select>
        </label>
        <button type="button" className="btn btn-soft" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore}>
          {showMore ? 'Fewer filters' : 'More filters'}
        </button>
        <button className="btn btn-ghost" onClick={() => setFilters(BLANK_FILTERS)}>
          Reset
        </button>
      </div>

      {showMore && (
        <div className="filters compact">
          <label className="field">
            <span>Min price (BDT)</span>
            <input type="number" min="0" value={filters.min_price} onChange={set('min_price')} />
          </label>
          <label className="field">
            <span>Max price (BDT)</span>
            <input type="number" min="0" value={filters.max_price} onChange={set('max_price')} />
          </label>
          <label className="field">
            <span>Available on</span>
            <input type="date" min={today()} value={filters.available_on} onChange={set('available_on')} />
          </label>
          <label className="field check-field">
            <input type="checkbox" checked={filters.verified === '1'} onChange={(event) => setFilters((current) => ({ ...current, verified: event.target.checked ? '1' : '' }))} />
            <span>ID-verified providers only</span>
          </label>
        </div>
      )}

      <Feedback error={error} notice={!selected ? actions.notice : ''} />

      {loading && !data && <Loading text="Loading services..." variant="cards" />}

      {data && data.length === 0 && (
        <Empty title="No services found" text="Try different filters or check back later." />
      )}

      <div className="grid">
        {data?.map((service) => (
          <article className="card" key={service.id}>
            <Thumb imageId={service.image_id} label={service.title} />
            <div className="card-row">
              <span className="badge badge-muted">{service.category_name || 'Other'}</span>
              <span className="price">{formatMoney(service.price)}</span>
            </div>
            {isSeeker && <HeartButton providerId={service.provider_id} saved={Number(service.is_favorite) > 0} onChange={() => reload(true)} />}

            <h3>{service.title}</h3>
            <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {service.description}
            </p>

            <div className="meta">
              <span><Icon name="pin" /> {service.location}</span>
            </div>

            <div className="meta">
              <span>
                by{' '}
                <b style={{ cursor: 'pointer' }} onClick={() => navigate(`/providers/${service.provider_id}`)}>
                  {service.provider_name}
                </b>
              </span>
              {service.nid_status === 'verified' && <span className="badge"><Icon name="check" /> ID verified</span>}
            </div>

            <div className="card-actions">
              {isSeeker && (
                <button className="btn btn-sm" onClick={() => openBooking(service)}>
                  Book now
                </button>
              )}
              <button className={`btn btn-sm ${isSeeker ? 'btn-ghost' : ''}`} onClick={() => navigate(`/providers/${service.provider_id}`)}>
                Profile
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setReport({ type: 'listing', id: service.id })}
                aria-label="Report listing"
              >
                <Icon name="flag" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {selected && (
        <Modal
          title={`Book: ${selected.title}`}
          subtitle={`${selected.provider_name} · ${formatMoney(selected.price)}`}
          onClose={() => setSelected(null)}
        >
          <Feedback error={actions.error} />
          <form className="form" onSubmit={book}>
            <div className="field">
              <span>Preferred date {booking.date && <b>· {booking.date}</b>}</span>
              <Calendar
                daysOff={calendar?.days_off || []}
                booked={calendar?.booked || []}
                selected={booking.date}
                onPick={(date) => setBooking((current) => ({ ...current, date }))}
              />
              <input type="date" className="sr-only" tabIndex={-1} aria-hidden="true" value={booking.date} onChange={() => {}} required />
            </div>
            <label className="field">
              <span>Describe what you need</span>
              <textarea
                value={booking.message}
                onChange={(event) => setBooking({ ...booking, message: event.target.value })}
                maxLength={1000}
                required
                placeholder="Address, timing, anything the provider should know..."
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                Cancel
              </button>
              <button className="btn" disabled={actions.busy}>
                {actions.busy ? 'Sending...' : 'Send booking request'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {report && <ReportDialog report={report} onClose={() => setReport(null)} />}
    </div>
  );
}
