import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from './api.js';
import { useAuth } from './auth.jsx';
import { CategoryIcon } from './categoryIcons.jsx';
import { JobRow, ListingRow } from './Explore.jsx';
import { Empty, Feedback, Loading, useLoad } from './ui.jsx';

/** One service type: what providers offer, and the jobs people have posted. */
export default function ExploreCategory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [chosen, setChosen] = useState(null);

  const overview = useLoad(() => apiFetch('/explore'), [id]);
  const offers = useLoad(() => apiFetch(`/provider-services?category_id=${encodeURIComponent(id)}&sort=rating`), [id]);
  const jobsLoad = useLoad(() => apiFetch(`/services?category_id=${encodeURIComponent(id)}&sort=newest`), [id]);

  const category = overview.data?.categories.find((c) => String(c.id) === String(id));

  // Ambulances and doctors are run by the admins, so these two service types open their own pages.
  useEffect(() => {
    if (category?.name === 'Ambulance') navigate('/emergency/ambulances', { replace: true });
    if (category?.name === 'Online Doctor') navigate('/emergency/doctors', { replace: true });
  }, [category, navigate]);
  const items = offers.data?.services || [];
  const jobs = jobsLoad.data?.services || [];
  const providers = new Set(items.map((s) => s.provider_id)).size;
  const loading = (overview.loading && !overview.data) || (offers.loading && !offers.data) || (jobsLoad.loading && !jobsLoad.data);

  // Open on whichever list has something in it.
  const tab = chosen || (items.length === 0 && jobs.length > 0 ? 'jobs' : 'offers');

  if (!loading && overview.data && !category) {
    return (
      <div className="ex">
        <div className="ex-body">
          <Empty title="Service type not found" action={<button className="btn" onClick={() => navigate('/explore')}>Back to all services</button>} />
        </div>
      </div>
    );
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div className="ex">
      <header className="ex-hero">
        <button type="button" className="ex-back" onClick={() => navigate('/explore')} aria-label="Back to all services">
          ‹
        </button>
        <div className="ex-hero-top">
          <span className="ex-hero-badge" aria-hidden="true"><CategoryIcon name={category?.name} /></span>
          <div>
            <h1>{category?.name || 'Loading...'}</h1>
            <p>{category ? `${plural(items.length, 'offer')} · ${plural(providers, 'provider')} · ${plural(jobs.length, 'open job')}` : ' '}</p>
          </div>
        </div>
      </header>

      <div className="ex-body">
        <Feedback error={overview.error || offers.error || jobsLoad.error} />

        {['Ambulance', 'Online Doctor'].includes(category?.name) && (
          <p className="em-warning">
            <b>In danger, call 999 first.</b>{' '}
            {category.name === 'Online Doctor'
              ? 'Online doctors give advice by chat or call. They cannot treat an emergency.'
              : 'For a life-threatening emergency, 999 can send an ambulance fastest.'}
          </p>
        )}

        <div className="ex-actions">
          <button className="btn" onClick={() => navigate(`/provider-services?category_id=${id}`)}>
            See all and book
          </button>
          <button className="btn btn-ghost" onClick={() => navigate(`/add-work?category_id=${id}`)}>
            Post work for this
          </button>
        </div>

        <div className="tabs ex-tabs">
          <button className={`tab ${tab === 'offers' ? 'on' : ''}`} onClick={() => setChosen('offers')}>
            Offers <span style={{ opacity: 0.7 }}>{items.length}</span>
          </button>
          <button className={`tab ${tab === 'jobs' ? 'on' : ''}`} onClick={() => setChosen('jobs')}>
            Open jobs <span style={{ opacity: 0.7 }}>{jobs.length}</span>
          </button>
        </div>

        {loading && <Loading text="Loading..." variant="cards" />}

        {!loading && tab === 'offers' && (
          <>
            {items.length === 0 && (
              <Empty
                title="No offers yet"
                text="Nobody offers this service yet. Post your work and providers can apply."
                action={
                  <button className="btn" onClick={() => navigate(`/add-work?category_id=${id}`)}>
                    Post work
                  </button>
                }
              />
            )}
            <div className="ex-list">
              {items.slice(0, 20).map((item) => (
                <ListingRow key={item.id} item={item} onOpen={(it) => (user.role === 'seeker' ? navigate(`/provider-services?open=${it.id}`) : navigate(`/providers/${it.provider_id}`))} />
              ))}
            </div>
          </>
        )}

        {!loading && tab === 'jobs' && (
          <>
            {jobs.length === 0 ? (
              <Empty
                title="No open jobs right now"
                text="When someone posts work in this service type, it shows here. Tap a job to read it and apply."
                action={
                  <button className="btn" onClick={() => navigate(`/add-work?category_id=${id}`)}>
                    Post work
                  </button>
                }
              />
            ) : (
              <p className="hint" style={{ margin: '0 0 10px' }}>Tap a job to read the details. Providers can apply from there.</p>
            )}
            <div className="ex-list">
              {jobs.slice(0, 40).map((job) => (
                <JobRow key={job.id} job={job} onOpen={(j) => navigate(`/work/${j.id}`)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
