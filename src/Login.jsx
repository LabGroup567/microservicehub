
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Auth.css';
import { apiFetch } from './api.js';
import { useAuth } from './auth.jsx';
import { LogoMark } from './Logo.jsx';
import Icon from './Icon.jsx';

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-gsi]');
    const script = existing || document.createElement('script');

    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });

    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client?hl=en';
      script.async = true;
      script.dataset.googleGsi = 'true';
      document.head.appendChild(script);
    }
  });
}

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const googleRef = useRef(null);
  const transitionTimer = useRef(null);

  const [lampClicked, setLampClicked] = useState(false);
  const [lampOn, setLampOn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      if (transitionTimer.current) {
        window.clearTimeout(transitionTimer.current);
      }
    };
  }, []);

  function turnOnLamp() {
    if (lampOn || lampClicked) return;

    setLampOn(true);

    transitionTimer.current = window.setTimeout(() => {
      setLampClicked(true);
    }, 1500);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiFetch('/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim(), password },
      });

      login(data);
      navigate('/');
    } catch (err) {
      setError(
        err.message ||
          'Unable to connect to the server. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  // Google sign-in button (only shown when the backend has a client ID).
  useEffect(() => {
    if (!lampClicked) return undefined;

    let cancelled = false;
    let observer = null;

    async function setupGoogle() {
      try {
        const config = await apiFetch('/config', { auth: false });
        if (!config.google_client_id || cancelled) return;

        await loadGoogleScript();
        if (cancelled || !googleRef.current || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: config.google_client_id,
          callback: async (response) => {
            setError('');
            try {
              const data = await apiFetch('/auth/google', {
                method: 'POST',
                auth: false,
                body: { credential: response.credential },
              });
              login(data);
              navigate('/');
            } catch (err) {
              setError(err.message);
            }
          },
        });

        // Draw at a width that fits the box now, and again whenever the box changes size
        // (the card animates in, and phones rotate), so the pill is never wider than its box.
        const element = googleRef.current;
        let drawnWidth = 0;

        const draw = () => {
          const width = Math.min(360, Math.max(200, Math.floor(element.clientWidth - 16)));
          if (Math.abs(width - drawnWidth) < 3) return;

          drawnWidth = width;
          element.innerHTML = '';
          window.google.accounts.id.renderButton(element, {
            theme: 'outline',
            size: 'large',
            shape: 'pill',
            text: 'continue_with',
            locale: 'en',
            width,
          });
        };

        draw();

        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(draw);
          observer.observe(element);
        }
      } catch {
        // Google sign-in is optional; the email form still works.
      }
    }

    setupGoogle();
    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
    };
  }, [lampClicked, login, navigate]);

  // Welcome screen with interactive lamp
  if (!lampClicked) {
    return (
      <main
        className={`mh-lamp-screen ${
          lampOn ? 'mh-lamp-on' : ''
        }`}
      >
        <div className="mh-room-glow" />
        <div className="mh-room-vignette" />

        <div className="mh-lamp-content">
          <div className="mh-lamp-scene">
            <div className="mh-lamp-cord" />

            <button
              type="button"
              className="mh-lamp"
              onClick={turnOnLamp}
              disabled={lampOn}
              aria-label="Turn on the lamp"
            >
              <span className="mh-lamp-top" />
              <span className="mh-lamp-shade" />
              <span className="mh-lamp-inner" />
              <span className="mh-lamp-bulb" />
              <span className="mh-lamp-stem" />
              <span className="mh-lamp-base" />
            </button>

            <div className="mh-lamp-light" />
            <div className="mh-lamp-floor" />
            <div className="mh-lamp-floor-reflection" />
          </div>

          <section className="mh-lamp-welcome">
            <p className="mh-eyebrow">WELCOME TO</p>

            <h1 className="mh-welcome-title">
              Micro<span>ServiceHub</span>
            </h1>

            <p className="mh-welcome-description">
              Your everyday help is just one click away.
            </p>

            <button
              type="button"
              className="mh-turn-on-button"
              onClick={turnOnLamp}
              disabled={lampOn}
            >
              <span className="mh-sun-icon">
                {lampOn ? <Icon name="sparkles" /> : <Icon name="sun" />}
              </span>

              {lampOn
                ? 'Lighting up your space...'
                : 'Turn on the light'}

              {!lampOn && (
                <span className="mh-button-arrow">→</span>
              )}
            </button>

            <p className="mh-click-hint">
              {lampOn
                ? 'A brighter experience is on its way...'
                : 'Click the lamp to get started'}
            </p>
          </section>
        </div>

        <p className="mh-lamp-footer">
          SMALL TASKS. BIG RELIEF.
        </p>
      </main>
    );
  }

  // Login screen
  return (
    <main className="mh-login-page">
      <section className="mh-login-visual">
        <div className="mh-visual-glow mh-visual-glow-one" />
        <div className="mh-visual-glow mh-visual-glow-two" />

        <div className="mh-brand">
          <LogoMark size={42} />
          <span>MicroServiceHub</span>
        </div>

        <div className="mh-visual-content">
          <div className="mh-hero-badge">
            <span className="mh-status-dot" />
            Your community, connected
          </div>

          <h1>
            A little help
            <br />
            goes a <span>long way.</span>
          </h1>

          <p className="mh-hero-description">
            Find trusted people for everyday tasks or share
            your skills with people who need them.
          </p>

          <div className="mh-feature-list">
            <div className="mh-feature">
              <span className="mh-feature-icon"><Icon name="check" /></span>
              <span>Find help for everyday tasks</span>
            </div>

            <div className="mh-feature">
              <span className="mh-feature-icon"><Icon name="check" /></span>
              <span>Connect with local service providers</span>
            </div>

            <div className="mh-feature">
              <span className="mh-feature-icon"><Icon name="check" /></span>
              <span>Build trust in your community</span>
            </div>
          </div>

          <div className="mh-visual-illustration mh-image-illustration">
            <div className="mh-image-halo" />

            <img
              className="mh-helper-image"
              src="/images/worker-cartoon.png"
              alt="MicroServiceHub helper illustration"
            />

            <div className="mh-illustration-card card-front">
              <span className="mh-card-check"><Icon name="check" /></span>

              <span>
                <strong>Help is here</strong>
                <small>People helping people</small>
              </span>
            </div>
          </div>
        </div>

        <p className="mh-visual-footer">
          © {new Date().getFullYear()} MicroServiceHub
        </p>
      </section>

      <section className="mh-login-form-section">
        <div className="mh-login-card">
          <div className="mh-mobile-brand">
            <LogoMark size={42} />
            <span>MicroServiceHub</span>
          </div>

          <div className="mh-form-heading">

            <p className="mh-form-eyebrow">
              WELCOME BACK
            </p>

            <h2>Let's get you in.</h2>

            <p className="mh-form-description">
              Enter your details to access your account.
            </p>
          </div>

          <form
            className="mh-login-form"
            onSubmit={handleSubmit}
          >
            <div className="mh-field">
              <label htmlFor="mh-email">
                Email address
              </label>

              <div className="mh-input-wrap">
                <span
                  className="mh-input-icon"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <rect
                      x="3"
                      y="5"
                      width="18"
                      height="14"
                      rx="3"
                    />
                    <path d="m4 7 8 6 8-6" />
                  </svg>
                </span>

                <input
                  id="mh-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="mh-field">
              <label htmlFor="mh-password">
                Password
              </label>

              <div className="mh-input-wrap">
                <span
                  className="mh-input-icon"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <rect
                      x="4"
                      y="10"
                      width="16"
                      height="11"
                      rx="3"
                    />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    <path d="M12 14v3" />
                  </svg>
                </span>

                <input
                  id="mh-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  autoComplete="current-password"
                  required
                />

                <button
                  type="button"
                  className="mh-password-toggle"
                  onClick={() =>
                    setShowPassword((value) => !value)
                  }
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="mh-forgot">
              <button type="button" onClick={() => navigate('/forgot-password')}>
                Forgot password?
              </button>
            </div>

            {error && (
              <div
                className="mh-error-message"
                role="alert"
              >
                <span>!</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="mh-submit-button"
              disabled={loading}
            >
              {loading
                ? 'Signing you in...'
                : 'Sign in to your account'}

              {!loading && <span>→</span>}
            </button>
          </form>

          <div className="mh-google-container" ref={googleRef} />

          {/* Create account option */}
          <div className="mh-create-account">
            <span>New to MicroServiceHub?</span>{' '}

            <button
              type="button"
              onClick={() => navigate('/register')}
            >
              Create account
            </button>
          </div>

          <div className="mh-form-divider">
            <span>SECURE ACCESS</span>
          </div>

          <div className="mh-security-note">
            <span className="mh-security-icon"><Icon name="check" /></span>

            <p>
              Your account is protected. Sign in with your
              registered email and password.
            </p>
          </div>

          <button
            type="button"
            className="mh-back-button"
            onClick={() => {
              setLampOn(false);
              setLampClicked(false);
              setError('');
            }}
          >
            ← Back to the welcome screen
          </button>
        </div>
      </section>
    </main>
  );
}
