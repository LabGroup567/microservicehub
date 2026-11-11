import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, formatMoney, imageUrl } from './api.js';
import { useAuth } from './auth.jsx';
import { ApplicationsArt, ExploreArt, FindProvidersArt, FindWorkArt, HireArt, PostWorkArt, ReviewArt, ServicesArt } from './Illustrations.jsx';
import { Loading, PulseStrip, useLoad } from './ui.jsx';
import { uploadPhoto } from './Photos.jsx';
import AvailableNow from './AvailableNow.jsx';
import GettingStarted from './GettingStarted.jsx';
import { DefaultAvatar } from './ProfilePhoto.jsx';
import './App.css';
import Icon from './Icon.jsx';

export default function App() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  const isSeeker = user.role === 'seeker';
  const isProvider = user.role === 'provider';
  const name = user.full_name || user.email || 'User';

  const { data: overview, loading } = useLoad(async () => {
    const path = isProvider ? '/provider/overview' : '/seeker/overview';
    return (await apiFetch(path)).overview;
  }, [user.role]);

  const { data: pulse } = useLoad(async () => (await apiFetch('/public-stats', { auth: false })).stats);

  // The hero picture is the member's real profile photo (saved on the server, so others see it too).
  const coverPhoto = user.avatar_image_id ? imageUrl(user.avatar_image_id) : '';
  const [photoError, setPhotoError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  async function saveAvatar(imageId) {
    const data = await apiFetch('/me/avatar', { method: 'PUT', body: { image_id: imageId } });
    updateUser({ avatar_image_id: data.user.avatar_image_id });
  }

  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setPhotoBusy(true);
    setPhotoError('');
    try {
      await saveAvatar(await uploadPhoto(file));
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removeCoverPhoto() {
    setPhotoBusy(true);
    setPhotoError('');
    try {
      await saveAvatar(null);
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setPhotoBusy(false);
    }
  }

  const stats = overview
    ? isProvider
      ? [
          { label: 'Total earnings', value: formatMoney(overview.total_earnings), hero: true },
          { label: 'Active jobs', value: Number(overview.active_jobs) + Number(overview.active_bookings) },
          { label: 'Pending applications', value: overview.pending_applications },
          { label: 'New booking requests', value: overview.pending_bookings },
        ]
      : [
          { label: 'Open work posts', value: overview.open_work, hero: true },
          { label: 'In progress', value: overview.active_work },
          { label: 'Applications to review', value: overview.pending_applications },
          { label: 'Completed work', value: overview.completed_work },
          { label: 'Active bookings', value: overview.active_bookings },
        ]
    : [];

  return (
    <div className="mh-page">
      <main>
        <section className="mh-account-wrap">
          <div className="mh-account-card">
            <div className="mh-account-left">
              <div className="mh-account-avatar">
                {user.avatar_image_id ? <img src={imageUrl(user.avatar_image_id)} alt="" /> : name.charAt(0).toUpperCase()}
              </div>

              <div>
                <span className="mh-account-label">YOUR ACCOUNT</span>
                <h2>Welcome back, {name}!</h2>
                <p>
                  {isSeeker
                    ? 'You are using MicroServiceHub as a Seeker.'
                    : 'You are using MicroServiceHub as a Provider.'}
                </p>
              </div>
            </div>

            <span className="mh-role-badge">
              <span className="mh-status-dot" />
              {isSeeker ? 'SEEKER' : 'PROVIDER'}
            </span>
          </div>
        </section>

        <div className="mh-start-wrap">
          <button type="button" className="em-strip" onClick={() => navigate('/emergency')}>
            <span aria-hidden="true"><Icon name="siren" /></span>
            <span>
              <b>Emergency help</b>
              <small>Ambulance · Online doctor · Blood bank</small>
            </span>
            <span className="em-strip-go" aria-hidden="true">→</span>
          </button>
          {isProvider && <AvailableNow />}
          <GettingStarted user={user} overview={overview} />
        </div>

        <section className="mh-hero">
          <div className="mh-hero-content">
            <span className="mh-eyebrow">YOUR TRUSTED EVERYDAY SERVICE PLATFORM</span>

            <h1>
              The right help for your
              <span> everyday needs.</span>
            </h1>

            <p className="mh-hero-description">
              MicroServiceHub connects people who need work done with people who have the
              skills to do it. Post a task, discover services, and connect with your local
              community.
            </p>

            <div className="mh-hero-actions">
              {isSeeker && (
                <>
                  <button className="mh-button" onClick={() => navigate('/add-work')}>
                    + Post Your Work
                  </button>
                  <button
                    className="mh-button mh-button-outline"
                    onClick={() => navigate('/my-bookings')}
                  >
                    My Bookings →
                  </button>
                </>
              )}

              {isProvider && (
                <>
                  <button className="mh-button" onClick={() => navigate('/services')}>
                    Find Available Work →
                  </button>
                  <button
                    className="mh-button mh-button-outline"
                    onClick={() => navigate('/my-services')}
                  >
                    My Services →
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mh-hero-visual">
            {coverPhoto ? (
              <img className="mh-hero-cover" src={coverPhoto} alt="Your profile photo" />
            ) : (
              <div className="mh-hero-cover mh-hero-silhouette">
                <DefaultAvatar />
              </div>
            )}

            <div className="mh-photo-controls">
              <label className="mh-photo-upload">
                <span><Icon name="camera" /></span>
                {photoBusy ? 'Uploading...' : coverPhoto ? 'Change Photo' : 'Upload Your Photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoUpload} disabled={photoBusy} hidden />
              </label>

              {coverPhoto && (
                <button type="button" className="mh-photo-remove" disabled={photoBusy} onClick={removeCoverPhoto}>
                  Remove Photo
                </button>
              )}
            </div>

            {photoError && (
              <p className="mh-photo-error" role="alert">
                {photoError}
              </p>
            )}

            <div className="mh-floating-card mh-floating-top">
              <span className="mh-floating-icon"><Icon name="check" /></span>
              <div>
                <strong>Find trusted help</strong>
                <span>Services for everyday needs</span>
              </div>
            </div>

            <div className="mh-floating-card mh-floating-bottom">
              <span className="mh-rating-star"><Icon name="star" filled /></span>
              <div>
                <strong>Your community, connected</strong>
                <span>Discover. Connect. Get it done.</span>
              </div>
            </div>
          </div>
        </section>

        <PulseStrip stats={pulse} />

        <section className="mh-section">
          <div className="mh-section-heading">
            <div>
              <span className="mh-eyebrow">AT A GLANCE</span>
              <h2>Your Overview</h2>
            </div>
          </div>

          {loading && <Loading />}

          <div className="stats">
            {stats.map((stat) => (
              <div className={`stat ${stat.hero ? 'hero' : ''}`} key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                {stat.note && <small>{stat.note}</small>}
              </div>
            ))}
          </div>
        </section>

        <section className="mh-section">
          <div className="mh-section-heading">
            <div>
              <span className="mh-eyebrow">YOUR WORKSPACE</span>
              <h2>Quick Actions</h2>
              <p>Everything you need, all in one place.</p>
            </div>
          </div>

          <div className="mh-dashboard-grid">
            {isSeeker && (
              <>
                <DashboardCard
                  art={<ExploreArt />}
                  kicker="BROWSE"
                  title="Explore Services"
                  description="Every service type in one place. Pick one and see who offers it."
                  button="Explore"
                  onClick={() => navigate('/explore')}
                />
                <DashboardCard
                  art={<PostWorkArt />}
                  kicker="FOR SEEKERS"
                  title="Post New Work"
                  description="Describe your task, set your budget, and publish your work request."
                  button="Add Work"
                  onClick={() => navigate('/add-work')}
                />
                <DashboardCard
                  art={<ReviewArt />}
                  kicker="YOUR REQUESTS"
                  title="My Posted Work"
                  description="Review applications, accept a provider and track progress."
                  button="View My Work"
                  onClick={() => navigate('/my-work')}
                />
                <DashboardCard
                  art={<FindProvidersArt />}
                  kicker="AVAILABLE NOW"
                  title="Providers Near You"
                  description="See verified providers who are free right now on a map."
                  button="Open Map"
                  onClick={() => navigate('/nearby')}
                />
                <DashboardCard
                  art={<HireArt />}
                  kicker="HIRE DIRECTLY"
                  title="Find Providers"
                  description="Browse provider services and book the one that fits."
                  button="Browse Providers"
                  onClick={() => navigate('/provider-services')}
                />
              </>
            )}

            {isProvider && (
              <>
                <DashboardCard
                  art={<FindWorkArt />}
                  kicker="OPPORTUNITIES"
                  title="Find Available Work"
                  description="Filter work requests by category, location and budget."
                  button="Find Work"
                  onClick={() => navigate('/services')}
                />
                <DashboardCard
                  art={<ServicesArt />}
                  kicker="YOUR BUSINESS"
                  title="My Services"
                  description="Create and manage the services you offer to customers."
                  button="Manage Services"
                  onClick={() => navigate('/my-services')}
                />
                <DashboardCard
                  art={<ApplicationsArt />}
                  kicker="YOUR ACTIVITY"
                  title="My Applications"
                  description="Track your applications and manage the jobs you won."
                  button="Applications"
                  onClick={() => navigate('/my-applications')}
                />
              </>
            )}
          </div>
        </section>

        <section className="mh-how-section">
          <div className="mh-section">
            <div className="mh-section-heading">
              <div>
                <span className="mh-eyebrow">SIMPLE BY DESIGN</span>
                <h2>How It Works</h2>
                <p>Three simple steps to get started.</p>
              </div>
            </div>

            <div className="mh-steps">
              <Step number="01" title="Post or Offer">
                Seekers post work. Providers list the services they offer.
              </Step>
              <Step number="02" title="Apply or Book">
                Providers apply to work, and seekers can book a provider directly.
              </Step>
              <Step number="03" title="Chat, Complete, Review">
                Talk in chat, share your location, confirm completion and write a review.
              </Step>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function DashboardCard({ art, kicker, title, description, button, onClick }) {
  return (
    <article className="mh-feature-card">
      <div className="mh-card-image">{art}</div>

      <div className="mh-card-content">
        <span className="mh-card-kicker">{kicker}</span>
        <h3>{title}</h3>
        <p>{description}</p>

        <button className="mh-card-action" onClick={onClick}>
          {button} <span>→</span>
        </button>
      </div>
    </article>
  );
}

function Step({ number, title, children }) {
  return (
    <article className="mh-step">
      <div className="mh-step-number">{number}</div>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  );
}
