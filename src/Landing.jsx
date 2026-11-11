import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from './api.js';
import { CategoryIcon } from './categoryIcons.jsx';
import { PublicShell } from './Public.jsx';
import { PulseStrip, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** What a visitor sees at the address before logging in. */
export default function Landing() {
  const navigate = useNavigate();
  const { data: categories } = useLoad(async () => (await apiFetch('/categories', { auth: false })).categories);
  const { data: pulse } = useLoad(async () => (await apiFetch('/public-stats', { auth: false })).stats);

  return (
    <PublicShell title="Everyday help, one click away" bare>
      <section className="land-hero">
        <div>
          <span className="eyebrow">Trusted help across Bangladesh</span>
          <h1>Everyday help, <em>one click away</em></h1>
          <p>
            Post a job or book a service. Verified providers apply, you chat, hire and pay safely with
            cash, bKash or Nagad.
          </p>
          <div className="land-cta">
            <button className="btn" onClick={() => navigate('/register')}>Get started free</button>
            <button className="btn btn-ghost" onClick={() => navigate('/login')}>I already have an account</button>
          </div>
          <ul className="land-points">
            <li><Icon name="check" /> Every member ID-verified</li>
            <li><Icon name="check" /> Online payments held until the job is done</li>
            <li><Icon name="check" /> Live location and in-app calls</li>
          </ul>
        </div>

        <div className="land-card" aria-hidden="true">
          <div className="land-row"><span><CategoryIcon name="Delivery" /></span><div><b>Parcel delivery</b><small>Dhanmondi · BDT 450</small></div><i>Open</i></div>
          <div className="land-row"><span><CategoryIcon name="Home Care" /></span><div><b>Deep home cleaning</b><small>Mirpur · BDT 1,800</small></div><i>Booked</i></div>
          <div className="land-row"><span><CategoryIcon name="Repairs" /></span><div><b>Fix a leaking tap</b><small>Uttara · BDT 700</small></div><i>Done <Icon name="check" /></i></div>
        </div>
      </section>

      <PulseStrip stats={pulse} />

      {categories?.length > 0 && (
        <section className="pub-section">
          <h2>What do you need today?</h2>
          <div className="land-cats">
            {categories.map((category) => (
              <button key={category.id} className="land-cat" onClick={() => navigate('/register')}>
                <span aria-hidden="true"><CategoryIcon name={category.name} /></span>
                <b>{category.name}</b>
                {category.description && <small>{category.description}</small>}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="pub-section">
        <h2>How it works</h2>
        <div className="land-steps">
          <div><i>1</i><b>Verify once</b><p>Upload your NID (or birth certificate if you are under 18) and a selfie so everyone knows who they are dealing with.</p></div>
          <div><i>2</i><b>Post or book</b><p>Describe the job, or pick a provider and a free day.</p></div>
          <div><i>3</i><b>Hire and chat</b><p>Compare providers, chat, call and follow live location.</p></div>
          <div><i>4</i><b>Pay and review</b><p>Pay your way, confirm the job and write a short review.</p></div>
        </div>
        <p className="pub-note"><Link to="/how-it-works">See the full guide</Link> or <Link to="/safety">read our safety tips</Link>.</p>
      </section>

      <section className="land-final">
        <h2>Ready to get things done, or get paid for what you do?</h2>
        <div className="land-cta">
          <button className="btn" onClick={() => navigate('/register')}>Create your free account</button>
        </div>
      </section>
    </PublicShell>
  );
}
