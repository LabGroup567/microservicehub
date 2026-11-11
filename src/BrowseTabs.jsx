import { useNavigate } from 'react-router-dom';

/** One switch for the two lists people browse: what providers offer, and the jobs people posted. */
export default function BrowseTabs({ active }) {
  const navigate = useNavigate();

  return (
    <div className="tabs browse-tabs" role="tablist" aria-label="What to browse">
      <button role="tab" aria-selected={active === 'offers'} className={`tab ${active === 'offers' ? 'on' : ''}`} onClick={() => navigate('/provider-services')}>
        Provider offers
      </button>
      <button role="tab" aria-selected={active === 'jobs'} className={`tab ${active === 'jobs' ? 'on' : ''}`} onClick={() => navigate('/services')}>
        Open jobs
      </button>
    </div>
  );
}
