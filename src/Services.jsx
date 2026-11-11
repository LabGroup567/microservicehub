import { useState } from 'react';
import BrowseTabs from './BrowseTabs.jsx';
import { useNavigate } from 'react-router-dom';
import { apiFetch, closesIn, formatDate, formatMoney } from './api.js';
import { Empty, Feedback, Loading, PageHead, useDebounced, useLoad } from './ui.jsx';
import { Thumb } from './Photos.jsx';
import { useAuth } from './auth.jsx';
import Icon from './Icon.jsx';

const BLANK = { q: '', location: '', category_id: '', min_budget: '', max_budget: '', sort: 'newest' };

export default function Services() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filters, setFilters] = useState(BLANK);
  const applied = useDebounced(filters);

  const { data: categories } = useLoad(async () => (await apiFetch('/categories')).categories);
  const { data, loading, error } = useLoad(async () => {
    const params = new URLSearchParams();
    Object.entries(applied).forEach(([key, value]) => value && params.set(key, value));
    return (await apiFetch(`/services?${params}`)).services;
  }, [applied]);

  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="pg">
      <PageHead
        title={user.role === 'provider' ? 'Find work' : 'Open jobs'}
        subtitle={user.role === 'provider' ? 'Browse open work requests and apply to the ones that fit your skills.' : 'Jobs that people have posted. Tap one to read the details.'}
      />

      <BrowseTabs active="jobs" />

      <div className="filters">
        <label className="field">
          <span>Search</span>
          <input value={filters.q} onChange={set('q')} placeholder="e.g. cleaning, delivery" />
        </label>
        <label className="field">
          <span>Location</span>
          <input value={filters.location} onChange={set('location')} placeholder="e.g. Mirpur" />
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
          <span>Min budget</span>
          <input type="number" min="0" value={filters.min_budget} onChange={set('min_budget')} />
        </label>
        <label className="field">
          <span>Max budget</span>
          <input type="number" min="0" value={filters.max_budget} onChange={set('max_budget')} />
        </label>
        <label className="field">
          <span>Sort by</span>
          <select value={filters.sort} onChange={set('sort')}>
            <option value="newest">Newest first</option>
            <option value="budget_high">Budget: high to low</option>
            <option value="budget_low">Budget: low to high</option>
          </select>
        </label>
        <button className="btn btn-ghost" onClick={() => setFilters(BLANK)}>
          Reset
        </button>
      </div>

      <Feedback error={error} />

      {loading && !data && <Loading text="Loading work requests..." variant="cards" />}

      {data && (
        <p style={{ margin: '0 0 16px', color: 'var(--mh-muted)' }}>{data.length} open request(s)</p>
      )}

      {data && data.length === 0 && (
        <Empty title="No matching work" text="Try different filters, or check back soon for new requests." />
      )}

      <div className="grid">
        {data?.map((work) => (
          <article className="card clickable" key={work.id} onClick={() => navigate(`/work/${work.id}`)}>
            <Thumb imageId={work.image_id} label={work.title} />
            <div className="card-row">
              <span className="badge badge-muted">{work.category_name || 'Other'}</span>
              <span className="price">{formatMoney(work.budget)}</span>
            </div>

            <h3>{work.title}</h3>
            <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {work.description}
            </p>

            <div className="meta">
              <span><Icon name="pin" /> {work.location}</span>
              <span>{formatDate(work.created_at)}</span>
              <span>
                by <b>{work.seeker_name}</b>
              </span>
              {closesIn(work.expires_at) && <span><Icon name="clock" /> {closesIn(work.expires_at)}</span>}
            </div>

            <div className="card-actions">
              {work.already_applied ? (
                <span className="badge badge-warn">Applied</span>
              ) : (
                <button className="btn btn-sm">{user.role === 'provider' ? 'View and apply' : 'View details'}</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
