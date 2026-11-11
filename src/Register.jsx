
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import './Auth.css';
import './RegisterPolish.css';
import { API } from './api.js';
import { LogoMark } from './Logo.jsx';
import Icon from './Icon.jsx';

export default function Register() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [form, setForm] = useState({
    referral_code: (params.get('ref') || '').toUpperCase().slice(0, 12),
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    role: 'seeker',
    agreed: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value, type, checked } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!form.agreed) {
      setError('Please agree to the Terms of service and Privacy policy to continue.');
      return;
    }

    if (form.password.length < 8) {
      setError('Your password must contain at least 8 characters.');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Your passwords do not match. Please try again.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API}/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            full_name: form.full_name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            password: form.password,
            role: form.role,
            referral_code: form.referral_code.trim() || undefined,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Unable to create your account.');
      }

      navigate('/login', {
        state: { registered: true },
      });
    } catch (err) {
      setError(
        err.message || 'Unable to connect to the server. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mh-register-page">
      <div className="mh-register-decoration mh-register-decoration-one" />
      <div className="mh-register-decoration mh-register-decoration-two" />

      <header className="mh-register-header">
        <Link to="/" className="mh-register-brand">
          <LogoMark size={40} />
          <span>
            MicroService<span className="mh-register-brand-accent">Hub</span>
          </span>
        </Link>

        <p className="mh-register-header-note">
          Already a member? <Link to="/login">Sign in</Link>
        </p>
      </header>

      <section className="mh-register-layout">
        <aside className="mh-register-intro">
          <span className="mh-register-eyebrow">
            <span className="mh-register-eyebrow-dot" />
            YOUR COMMUNITY. YOUR OPPORTUNITY.
          </span>

          <h1>
            Good things happen when
            <span> people help people.</span>
          </h1>

          <p className="mh-register-intro-text">
            Join a community built around trust, useful skills,
            and everyday support. Find the help you need or share
            what you do best.
          </p>

          <div className="mh-register-benefits">
            <div className="mh-register-benefit">
              <span className="mh-register-benefit-icon"><Icon name="check" /></span>
              <div>
                <strong>One account, more possibilities</strong>
                <p>Get started with a simple registration.</p>
              </div>
            </div>

            <div className="mh-register-benefit">
              <span className="mh-register-benefit-icon">⌖</span>
              <div>
                <strong>Connect with your community</strong>
                <p>Discover opportunities to give and receive help.</p>
              </div>
            </div>

            <div className="mh-register-benefit">
              <span className="mh-register-benefit-icon">↗</span>
              <div>
                <strong>Put your skills to work</strong>
                <p>Create a provider account to offer services.</p>
              </div>
            </div>
          </div>

          <div className="mh-register-quote">
            <span className="mh-register-quote-mark">“</span>
            <p>A little help can make a big difference.</p>
            <span className="mh-register-quote-line" />
          </div>
        </aside>

        <section className="mh-register-card">
          <div className="mh-register-card-top">
            <span className="mh-register-step">YOUR NEXT CHAPTER STARTS HERE</span>
          </div>

          <div className="mh-register-title">
            <h2>Create your account</h2>
            <p>Enter your details below to join MicroServiceHub.</p>
          </div>

          <form
            className="mh-register-form"
            onSubmit={handleSubmit}
          >
            <div className="mh-register-field">
              <label htmlFor="register-full-name">Full name</label>
              <div className="mh-register-input-wrap">
                <span className="mh-register-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M5 20c0-3.5 2.8-5.5 7-5.5s7 2 7 5.5" />
                  </svg>
                </span>
                <input
                  id="register-full-name"
                  name="full_name"
                  type="text"
                  placeholder="Enter your full name"
                  value={form.full_name}
                  onChange={handleChange}
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </div>
            </div>

            <div className="mh-register-field">
              <label htmlFor="register-email">Email address</label>
              <div className="mh-register-input-wrap">
                <span className="mh-register-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="5" width="17" height="14" rx="3" />
                    <path d="m5 7 7 5.5L19 7" />
                  </svg>
                </span>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="mh-register-field">
              <label htmlFor="register-phone">
                Phone number <span className="mh-register-optional">OPTIONAL</span>
              </label>
              <div className="mh-register-input-wrap">
                <span className="mh-register-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
                    <path d="M10 17.5h4" />
                  </svg>
                </span>
                <input
                  id="register-phone"
                  name="phone"
                  type="tel"
                  placeholder="Enter your phone number"
                  value={form.phone}
                  onChange={handleChange}
                  autoComplete="tel"
                />
              </div>
            </div>

            <div className="mh-register-field">
              <label htmlFor="register-referral">
                Referral code <span className="mh-register-optional">OPTIONAL</span>
              </label>
              <div className="mh-register-input-wrap">
                <input
                  id="register-referral"
                  name="referral_code"
                  type="text"
                  placeholder="Got a code from a friend?"
                  value={form.referral_code}
                  onChange={handleChange}
                  maxLength={12}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="mh-register-field">
              <label>Choose your account type</label>

              <div className="mh-register-role-options">
                <label
                  className={`mh-register-role-option ${
                    form.role === 'seeker' ? 'is-selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value="seeker"
                    checked={form.role === 'seeker'}
                    onChange={handleChange}
                  />
                  <span className="mh-register-role-symbol">⌕</span>
                  <span className="mh-register-role-copy">
                    <strong>Find services</strong>
                    <small>I need help with tasks</small>
                  </span>
                  <span className="mh-register-role-check"><Icon name="check" /></span>
                </label>

                <label
                  className={`mh-register-role-option ${
                    form.role === 'provider' ? 'is-selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value="provider"
                    checked={form.role === 'provider'}
                    onChange={handleChange}
                  />
                  <span className="mh-register-role-symbol">↗</span>
                  <span className="mh-register-role-copy">
                    <strong>Offer services</strong>
                    <small>I want to share my skills</small>
                  </span>
                  <span className="mh-register-role-check"><Icon name="check" /></span>
                </label>
              </div>
            </div>

            <div className="mh-register-field">
              <label htmlFor="register-password">Password</label>
              <div className="mh-register-input-wrap">
                <span className="mh-register-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="4.5" y="10" width="15" height="11" rx="2.5" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    <path d="M12 14v3" />
                  </svg>
                </span>
                <input
                  id="register-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={handleChange}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="mh-register-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="mh-register-field">
              <label htmlFor="register-confirm-password">
                Confirm password
              </label>
              <div className="mh-register-input-wrap">
                <span className="mh-register-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="4.5" y="10" width="15" height="11" rx="2.5" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    <path d="m9 15 2 2 4-4" />
                  </svg>
                </span>
                <input
                  id="register-confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Enter your password again"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="mh-register-toggle"
                  onClick={() =>
                    setShowConfirmPassword((value) => !value)
                  }
                  aria-label={
                    showConfirmPassword
                      ? 'Hide confirmation password'
                      : 'Show confirmation password'
                  }
                >
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <div className="mh-register-error" role="alert">
                <span>!</span>
                <p>{error}</p>
              </div>
            )}

            <label className="mh-register-terms">
              <input type="checkbox" name="agreed" checked={form.agreed} onChange={handleChange} />
              <span>
                I agree to the <Link to="/terms" target="_blank">Terms of service</Link> and{' '}
                <Link to="/privacy" target="_blank">Privacy policy</Link>.
              </span>
            </label>

            <button
              type="submit"
              className="mh-register-submit"
              disabled={loading}
            >
              <span>
                {loading ? 'Creating your account...' : 'Create my account'}
              </span>
              {!loading && <span className="mh-register-submit-arrow">→</span>}
            </button>

            <p className="mh-register-terms">
              By creating an account, you agree to use MicroServiceHub
              responsibly.
            </p>
          </form>

          <div className="mh-register-bottom">
            <span>Already have an account?</span>
            <Link to="/login">Sign in instead →</Link>
          </div>
        </section>
      </section>

      <footer className="mh-register-footer">
        <span>© {new Date().getFullYear()} MicroServiceHub</span>
        <span>Built for people helping people.</span>
      </footer>
    </main>
  );
}
