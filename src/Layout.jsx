import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, imageUrl } from './api.js';
import { useAuth } from './auth.jsx';
import { LogoMark } from './Logo.jsx';
import { resumePresence, stopPresence } from './presence.js';
import { PushBanner } from './PushToggle.jsx';
import { useRealtime } from './realtime.jsx';
import { useTheme } from './theme.js';
import './ui.css';
import Icon from './Icon.jsx';

const LINKS = {
  seeker: [
    ['/', 'Home'],
    ['/explore', 'Explore'],
    ['/add-work', 'Post Work'],
    ['/my-work', 'My Work'],
    ['/provider-services', 'Find Providers'],
    ['/my-bookings', 'My Bookings'],
  ],
  provider: [
    ['/', 'Home'],
    ['/services', 'Find Work'],
    ['/my-applications', 'Applications'],
    ['/my-services', 'My Services'],
    ['/provider-bookings', 'Bookings'],
  ],
  admin: [
    ['/admin', 'Admin Panel'],
  ],
};

const TITLES = {
  '/': 'Home',
  '/add-work': 'Post work',
  '/my-work': 'My work',
  '/provider-services': 'Find providers',
  '/nearby': 'Providers near you',
  '/explore': 'Explore services',
  '/emergency': 'Emergency help',
  '/blood': 'Blood bank',
  '/emergency/ambulances': 'Ambulance',
  '/emergency/doctors': 'Doctors',
  '/my-bookings': 'My bookings',
  '/services': 'Find work',
  '/my-applications': 'Applications',
  '/my-services': 'My services',
  '/provider-bookings': 'Bookings',
  '/admin': 'Admin panel',
  '/profile': 'Profile',
  '/messages': 'Messages',
  '/notifications': 'Notifications',
  '/payments': 'Payments',
  '/kyc': 'Identity verification',
  '/support': 'Help and support',
  '/disputes': 'My disputes',
  '/referrals': 'Invite friends',
  '/work': 'Work details',
  '/providers': 'Provider profile',
};

const TAB_ICONS = {
  '/': <Icon name="home" />,
  '/add-work': <Icon name="plus" />,
  '/explore': <Icon name="compass" />,
  '/my-work': <Icon name="list" />,
  '/provider-services': <Icon name="search" />,
  '/my-bookings': <Icon name="calendar" />,
  '/services': <Icon name="search" />,
  '/my-applications': <Icon name="inbox" />,
  '/my-services': <Icon name="wrench" />,
  '/provider-bookings': <Icon name="calendar" />,
};

const SHORT = { 'Post Work': 'Post', 'My Work': 'Work', 'Find Providers': 'Find', 'My Bookings': 'Bookings', 'Find Work': 'Find', Applications: 'Applied', 'My Services': 'Services' };

export default function Layout() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const { socket } = useRealtime();
  const [toast, setToast] = useState(null);
  const [counters, setCounters] = useState({ notifications: 0, messages: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const [linksOpen, setLinksOpen] = useState(false);

  // Unread counters: refreshed on navigation, instantly via the socket, and slowly as a fallback.
  const loadCounters = useCallback(async () => {
    try {
      const data = await apiFetch('/counters');
      setCounters({ notifications: data.notifications, messages: data.messages });
    } catch {
      // The navbar badges are best-effort.
    }
  }, []);

  useEffect(() => {
    loadCounters();
    const timer = window.setInterval(() => !document.hidden && loadCounters(), 30000);
    return () => window.clearInterval(timer);
  }, [location.pathname, loadCounters]);

  useEffect(() => {
    if (!socket) return undefined;

    const onNotification = (notification) => {
      loadCounters();
      setToast(notification);

      // An admin decision changes what this user may do, so refresh their profile.
      if (notification.type === 'kyc_status') {
        apiFetch('/me').then((data) => updateUser(data.user)).catch(() => {});
      }
    };
    const onMessage = (message) => {
      if (message.sender_id !== user.id) loadCounters();
    };

    socket.on('notification:new', onNotification);
    socket.on('message:new', onMessage);

    return () => {
      socket.off('notification:new', onNotification);
      socket.off('message:new', onMessage);
    };
  }, [socket, loadCounters, user.id, updateUser]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setMenuOpen(false);
    setLinksOpen(false);
    window.scrollTo(0, 0);

    const key = Object.keys(TITLES)
      .filter((path) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)))
      .sort((a, b) => b.length - a.length)[0];
    document.title = key ? `${TITLES[key]} · MicroServiceHub` : 'MicroServiceHub';
  }, [location.pathname]);

  useEffect(() => {
    if (user.role !== 'provider') return undefined;
    resumePresence();
    return stopPresence;
  }, [user.role]);

  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
    };
  }, []);

  const links = LINKS[user.role] || LINKS.seeker;
  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  function signOut() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      {offline && (
        <div className="offline-bar" role="alert">
          You are offline. Changes will not be saved until your connection is back.
        </div>
      )}
      <header className="nav">
        <div className="nav-inner">
          <button className="nav-brand" onClick={() => navigate('/')}>
            <LogoMark size={36} />
            <span>
              MicroService<b>Hub</b>
            </span>
          </button>

          <nav className={`nav-links ${linksOpen ? 'open' : ''}`} aria-label="Main">
            {links.map(([path, label]) => (
              <button
                key={path}
                className={`nav-link ${isActive(path) ? 'active' : ''}`}
                onClick={() => navigate(path)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="nav-actions">
            <button
              className="nav-icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Icon name="sun" /> : <Icon name="moon" />}
            </button>

            <button
              className={`nav-icon ${isActive('/messages') ? 'active' : ''}`}
              onClick={() => navigate('/messages')}
              aria-label={`Messages${counters.messages ? `, ${counters.messages} unread` : ''}`}
              title="Messages"
            >
              <Icon name="chat" />
              {counters.messages > 0 && <span className="nav-dot">{counters.messages}</span>}
            </button>

            <button
              className={`nav-icon ${isActive('/notifications') ? 'active' : ''}`}
              onClick={() => navigate('/notifications')}
              aria-label={`Notifications${counters.notifications ? `, ${counters.notifications} unread` : ''}`}
              title="Notifications"
            >
              <Icon name="bell" />
              {counters.notifications > 0 && (
                <span className="nav-dot">{counters.notifications}</span>
              )}
            </button>

            <div className="nav-user">
              <button
                className="nav-avatar"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
              >
                {user.avatar_image_id ? (
                  <span><img src={imageUrl(user.avatar_image_id)} alt="" /></span>
                ) : (
                  <span>{(user.full_name || '?').charAt(0).toUpperCase()}</span>
                )}
                <b>{user.full_name?.split(' ')[0]}</b>
              </button>

              {menuOpen && (
                <div className="nav-menu">
                  <div className="nav-menu-head">
                    <strong>{user.full_name}</strong>
                    <small>{user.role}</small>
                  </div>
                  <button onClick={() => navigate('/profile')}>Profile and settings</button>
                  <button onClick={() => navigate('/messages')}>Messages</button>
                  <button onClick={() => navigate('/notifications')}>Notifications</button>
                  {user.role !== 'admin' && <button onClick={() => navigate('/payments')}>Payments</button>}
                  {user.role !== 'admin' && <button onClick={() => navigate('/disputes')}>My disputes</button>}
                  {user.role === 'provider' && <button onClick={() => navigate('/earnings')}>My earnings</button>}
                  {user.role === 'seeker' && <button onClick={() => navigate('/favorites')}>Saved providers</button>}
            {user.role !== 'admin' && <button onClick={() => navigate('/referrals')}>Invite friends</button>}
                  {user.role !== 'admin' && <button onClick={() => navigate('/emergency')}>Emergency help</button>}
                  {user.role !== 'admin' && <button onClick={() => navigate('/kyc')}>Identity verification</button>}
                  {user.role !== 'admin' && <button onClick={() => navigate('/support')}>Help and support</button>}
                  <button className="danger" onClick={signOut}>
                    Log out
                  </button>
                </div>
              )}
            </div>

            <button
              className="nav-icon nav-toggle"
              onClick={() => setLinksOpen((open) => !open)}
              aria-label="Toggle menu"
              aria-expanded={linksOpen}
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
      </header>

      {user.role !== 'admin' && user.kyc_status !== 'verified' && (
        <div className="kyc-banner" role="region" aria-label="Identity verification">
          <span>
            <Icon name="id" />{' '}
            <b>
              {user.kyc_status === 'pending'
                ? 'Your identity documents are under review.'
                : user.kyc_status === 'rejected'
                  ? 'Your identity verification was rejected.'
                  : 'Verify your identity to get started.'}
            </b>{' '}
            {user.kyc_status === 'pending'
              ? 'You can browse and chat now. Posting, applying and booking unlock once an admin approves it.'
              : 'Posting work, applying, listing services and booking require a verified identity.'}
          </span>
          <button className="btn btn-sm" onClick={() => navigate('/kyc')}>
            {user.kyc_status === 'pending' ? 'View status' : user.kyc_status === 'rejected' ? 'Fix and resubmit' : 'Verify now'}
          </button>
        </div>
      )}

      {user.role === 'provider' && <PushBanner />}

      <main className="app-main">
        <Outlet />
      </main>

      {toast && (
        <button
          className="toast"
          onClick={() => {
            setToast(null);
            navigate(toast.link || '/notifications');
          }}
        >
          <strong><Icon name="bell" /> {toast.title}</strong>
          {toast.body && <span>{toast.body}</span>}
        </button>
      )}

      {user.role !== 'admin' && (
        <nav className="tabbar" aria-label="Quick navigation">
          {links.map(([path, label]) => (
            <button key={path} className={`tabbar-item ${isActive(path) ? 'active' : ''}`} onClick={() => navigate(path)} aria-label={label}>
              <span aria-hidden="true">{TAB_ICONS[path] || '•'}</span>
              <b>{SHORT[label] || label}</b>
            </button>
          ))}
        </nav>
      )}

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="footer-logo">
              <LogoMark size={40} />
              <strong>
                MicroService<b>Hub</b>
              </strong>
            </div>
            <p>Post a job or book a trusted provider. Chat, track, pay safely and review, all in one place.</p>
            <ul className="footer-trust">
              <li><Icon name="check" /> ID-verified members</li>
              <li><Icon name="check" /> Payments held until done</li>
              <li><Icon name="check" /> Cash or Nagad</li>
            </ul>
          </div>

          <nav className="footer-col" aria-label="Quick links">
            <h4>Quick links</h4>
            {links.map(([path, label]) => (
              <button key={path} onClick={() => navigate(path)}>
                {label}
              </button>
            ))}
          </nav>

          <nav className="footer-col" aria-label="Account">
            <h4>Account</h4>
            <button onClick={() => navigate('/profile')}>Profile and settings</button>
            <button onClick={() => navigate('/messages')}>Messages</button>
            <button onClick={() => navigate('/notifications')}>Notifications</button>
            {user.role !== 'admin' && <button onClick={() => navigate('/payments')}>Payments</button>}
            {user.role !== 'admin' && <button onClick={() => navigate('/disputes')}>My disputes</button>}
            {user.role !== 'admin' && <button onClick={() => navigate('/referrals')}>Invite friends</button>}
            {user.role !== 'admin' && <button onClick={() => navigate('/kyc')}>Identity verification</button>}
          </nav>

          <nav className="footer-col" aria-label="Company">
            <h4>Help and company</h4>
            <button onClick={() => navigate('/how-it-works')}>How it works</button>
            <button onClick={() => navigate('/safety')}>Safety tips</button>
            <button onClick={() => navigate('/help')}>Help and FAQ</button>
            {user.role !== 'admin' && <button onClick={() => navigate('/support')}>Help and support</button>}
            <button onClick={() => navigate('/about')}>About us</button>
            <button onClick={() => navigate('/contact')}>Contact us</button>
          </nav>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} MicroServiceHub. All rights reserved.</span>
          <span className="footer-legal">
            <button onClick={() => navigate('/terms')}>Terms</button>
            <button onClick={() => navigate('/privacy')}>Privacy</button>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top ↑</button>
          </span>
        </div>
      </footer>
    </>
  );
}
