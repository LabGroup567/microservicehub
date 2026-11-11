import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';
import { useAuth } from './auth.jsx';
import { LogoMark } from './Logo.jsx';
import { Feedback, useActions } from './ui.jsx';

const UPDATED = '18 October 2026';

export const PUBLIC_LINKS = [
  ['/how-it-works', 'How it works'],
  ['/safety', 'Safety tips'],
  ['/help', 'Help and FAQ'],
  ['/about', 'About us'],
  ['/contact', 'Contact us'],
];

/** Header, content column and footer shared by every public page (no login needed). */
export function PublicShell({ title, intro, bare = false, children }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `${title} · MicroServiceHub`;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="pub">
      <header className="pub-nav">
        <div className="pub-nav-inner">
          <Link to="/" className="nav-brand" aria-label="MicroServiceHub home">
            <LogoMark size={34} />
            <span>MicroService<b>Hub</b></span>
          </Link>

          <nav className="pub-links" aria-label="Pages">
            {PUBLIC_LINKS.map(([path, label]) => (
              <NavLink key={path} to={path}>{label}</NavLink>
            ))}
          </nav>

          <div className="pub-cta">
            {user ? (
              <button className="btn btn-sm" onClick={() => navigate('/')}>Open the app</button>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>Log in</button>
                <button className="btn btn-sm" onClick={() => navigate('/register')}>Sign up</button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="pub-main">
        {!bare && <h1>{title}</h1>}
        {!bare && intro && <p className="pub-intro">{intro}</p>}
        {children}
      </main>

      <footer className="pub-footer">
        <div>
          <b>MicroServiceHub</b>
          <span>Small tasks. Big relief.</span>
        </div>
        <nav aria-label="Legal and company">
          {PUBLIC_LINKS.map(([path, label]) => <Link key={path} to={path}>{label}</Link>)}
          <Link to="/terms">Terms of service</Link>
          <Link to="/privacy">Privacy policy</Link>
        </nav>
        <small>© {new Date().getFullYear()} MicroServiceHub. All rights reserved.</small>
      </footer>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="pub-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------- How it works ----------

export function HowItWorks() {
  return (
    <PublicShell title="How it works" intro="MicroServiceHub connects people who need a job done with verified people who can do it.">
      <div className="pub-split">
        <section className="pub-card">
          <span className="eyebrow">If you need help</span>
          <h2>Seekers</h2>
          <ol className="pub-steps">
            <li><b>Verify your identity.</b> Upload your NID and a selfie once. Under 18? Use your birth certificate instead. An admin checks it.</li>
            <li><b>Post your work or book a service.</b> Describe the job and your budget, or pick a provider and a free day on their calendar.</li>
            <li><b>Choose and chat.</b> Providers apply. Compare them, chat in the app and hire the one you like.</li>
            <li><b>Pay safely.</b> Pay cash or by Nagad directly to the provider.</li>
            <li><b>Confirm and review.</b> Mark the job complete and write a short review.</li>
          </ol>
        </section>

        <section className="pub-card">
          <span className="eyebrow">If you offer a service</span>
          <h2>Providers</h2>
          <ol className="pub-steps">
            <li><b>Verify your identity.</b> It is required to apply, list services and get paid.</li>
            <li><b>List what you offer.</b> Add a photo, a price and the days you are not available.</li>
            <li><b>Apply and get booked.</b> Apply to open work, or wait for booking requests.</li>
            <li><b>Do the job.</b> Share your live location so the customer can follow you, and talk in the app or by call.</li>
            <li><b>Get paid.</b> Confirm cash or direct payments, or receive online payments after the customer confirms the job.</li>
          </ol>
        </section>
      </div>

      <Section title="What makes it trustworthy">
        <ul className="pub-list">
          <li>Everyone must verify their identity (National ID, or birth certificate under 18) before they can post, apply or book.</li>
          <li>Online payments are held in escrow until the customer confirms the work.</li>
          <li>If something goes wrong, either side can open a dispute and an admin decides.</li>
          <li>Written reviews from real, completed jobs.</li>
        </ul>
      </Section>
    </PublicShell>
  );
}

// ---------- Safety ----------

export function Safety() {
  return (
    <PublicShell title="Safety tips" intro="A few habits keep every job smooth and safe.">
      <Section title="Before the job">
        <ul className="pub-list">
          <li>Check the person has the <b>ID verified</b> badge and read their reviews.</li>
          <li>Keep chatting and agreeing details <b>inside MicroServiceHub</b>, so there is a record if you need help.</li>
          <li>Agree the price, the place and the time before anyone starts.</li>
        </ul>
      </Section>
      <Section title="On the day">
        <ul className="pub-list">
          <li>Meet in a place you feel comfortable. Let someone know where you are going.</li>
          <li>Seekers and providers can both share live location with each other while the job is on. Admins can see shared locations to help if something goes wrong.</li>
          <li>If anything feels wrong, stop the job and contact support.</li>
        </ul>
      </Section>
      <Section title="Emergencies and health">
        <ul className="pub-list">
          <li>In danger, or if someone's life is at risk, <b>call 999 first</b>. Then use the Emergency help page for an ambulance, an online doctor or blood.</li>
          <li>Online doctors on MicroServiceHub give advice by chat or call. They cannot treat an emergency. Check the registration number on their listing.</li>
          <li>Blood: we connect donors and families, but we do not test or store blood. Always get blood from a licensed blood bank or hospital and have it screened.</li>
          <li>Share your phone number only with a donor or family you chose to help or ask. You can leave the donor list at any time.</li>
        </ul>
      </Section>
      <Section title="Payments">
        <ul className="pub-list">
          <li>Prefer <b>online payment</b>: the money is held until you confirm the work is done.</li>
          <li>Never pay a provider outside the app for a job you booked through it, and never send money to someone who asks you to "pay first" for a reason that sounds odd.</li>
          <li>We never ask for your Nagad PIN or OTP. Do not share them with anyone, including us.</li>
          <li>When you pay directly by Nagad, keep the TrxID message.</li>
        </ul>
      </Section>
      <Section title="If something goes wrong">
        <p>Open the job's payment screen and choose <b>Report a problem</b>. An admin reviews it and any money held for that job stays on hold until they decide. You can also <Link to="/contact">contact us</Link> at any time.</p>
      </Section>
    </PublicShell>
  );
}

// ---------- Help and FAQ ----------

const FAQ = [
  ['Why do I need to verify my NID?', 'It keeps the community safe. Seekers and providers can see that the other side is a real, verified person. Your NID details and photos are visible only to you and to MicroServiceHub admins who review them.'],
  ['I am under 18. Can I join?', 'Yes, from age 13. If you are under 18 you verify with your birth certificate and a selfie instead of an NID. The same privacy rules apply: only you and the admins who review it can see your documents.'],
  ['How long does verification take?', 'An admin reviews each submission. You get a notification when it is approved or when we need a clearer photo.'],
  ['How do I pay?', 'You can pay cash on delivery, or send money by Nagad to the provider and enter the TrxID. Open the job and choose Payment.'],
  ['What is the service fee?', 'Online payments may carry a small service fee that is shown before you pay. The provider always receives the full price. Payments you send straight to a provider have no fee.'],
  ['What if the provider does not show up?', 'Open the payment screen and choose Report a problem. Any online payment stays on hold, an admin looks at both sides, and you can be refunded.'],
  ['Can I cancel?', 'You can cancel a booking or work post before it starts, from My bookings or My work.'],
  ['How do promo and referral codes work?', 'Enter a code on the online payment screen to lower the total. Share your referral code from Invite friends: your friend gets a welcome code and you get a reward after their first online payment.'],
  ['I forgot my password.', 'Use "Forgot password?" on the login page. We email you a link that works once.'],
  ['How do I delete my account?', 'Contact us from the Contact page and we will help you. Some records about completed jobs and payments may be kept as the law requires.'],
];

export function Help() {
  const [open, setOpen] = useState(0);

  return (
    <PublicShell title="Help and FAQ" intro="Quick answers to common questions. Cannot find yours? Contact us.">
      <div className="faq">
        {FAQ.map(([question, answer], index) => (
          <div className={`faq-item ${open === index ? 'is-open' : ''}`} key={question}>
            <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}>
              <span>{question}</span>
              <i aria-hidden="true">{open === index ? '−' : '+'}</i>
            </button>
            {open === index && <p>{answer}</p>}
          </div>
        ))}
      </div>
      <p className="pub-note">Still stuck? <Link to="/contact">Send us a message</Link>.</p>
    </PublicShell>
  );
}

// ---------- About ----------

export function About() {
  return (
    <PublicShell title="About us" intro="Everyday help should be easy to find and easy to trust.">
      <Section title="Our mission">
        <p>
          Many small jobs, like a parcel to deliver, a tap to fix or a flat to clean, are still arranged through
          word of mouth and unknown numbers. MicroServiceHub gives people in Bangladesh one safe place to ask for
          help, offer their skills and get paid fairly.
        </p>
      </Section>
      <Section title="What we believe">
        <ul className="pub-list">
          <li><b>Trust first.</b> Verified identities, honest reviews and a fair way to settle problems.</li>
          <li><b>Fair for providers.</b> Providers set their price and keep it. Online payments are protected so they are not left unpaid.</li>
          <li><b>Simple for everyone.</b> Plain English, works on a phone, and uses the payment methods people already use: cash and Nagad.</li>
        </ul>
      </Section>
      <p className="pub-note">Questions or ideas? <Link to="/contact">We would love to hear from you</Link>.</p>
    </PublicShell>
  );
}

// ---------- Contact ----------

export function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.full_name || '', email: user?.email || '', message: '' });
  const [sent, setSent] = useState(false);
  const actions = useActions();
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const ok = await actions.run(() => apiFetch('/contact', { method: 'POST', body: form, auth: false }));
    if (ok) setSent(true);
  }

  return (
    <PublicShell title="Contact us" intro="Send us a message and we will reply by email.">
      {sent ? (
        <div className="pub-card pub-thanks">
          <h2>Thank you!</h2>
          <p>{actions.notice}</p>
          <Link to="/" className="btn btn-sm">Back to home</Link>
        </div>
      ) : (
        <form className="pub-card form" onSubmit={submit}>
          <Feedback error={actions.error} />
          <div className="form-row">
            <label className="field">
              <span>Your name</span>
              <input value={form.name} onChange={set('name')} maxLength={100} required autoComplete="name" />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={form.email} onChange={set('email')} maxLength={150} required autoComplete="email" />
            </label>
          </div>
          <label className="field">
            <span>How can we help?</span>
            <textarea value={form.message} onChange={set('message')} minLength={10} maxLength={2000} required />
          </label>
          <div className="pg-actions">
            <button className="btn" disabled={actions.busy}>{actions.busy ? 'Sending...' : 'Send message'}</button>
          </div>
          <small className="quote">Already have an account? Logged-in users can also use Help and support for a live chat with our team.</small>
        </form>
      )}
    </PublicShell>
  );
}

// ---------- Terms and privacy ----------

export function Terms() {
  return (
    <PublicShell title="Terms of service" intro={`Last updated ${UPDATED}. Please read these terms before using MicroServiceHub.`}>
      <Section title="1. About the service">
        <p>MicroServiceHub is a marketplace. It helps people who need a job done (&quot;seekers&quot;) find people who offer services (&quot;providers&quot;). We are not the employer of any provider and we do not perform the services ourselves.</p>
      </Section>
      <Section title="2. Your account">
        <ul className="pub-list">
          <li>You must be at least 13 years old and give true information. People under 18 verify with a birth certificate and should use the service with the knowledge of a parent or guardian.</li>
          <li>You must verify your identity with a valid National ID and a selfie before you post work, apply, list a service or book.</li>
          <li>Keep your password private. You are responsible for what happens on your account.</li>
          <li>One person, one account. We may suspend accounts that break these terms.</li>
        </ul>
      </Section>
      <Section title="3. Using the platform">
        <ul className="pub-list">
          <li>Do not post illegal, misleading, harmful or offensive content, or ask for work that breaks the law.</li>
          <li>Do not harass, threaten or discriminate against anyone.</li>
          <li>Be honest in reviews. Fake or paid reviews are not allowed.</li>
          <li>Do not try to avoid the platform's safety features, for example by taking a booked job outside the app to avoid fees or protection.</li>
        </ul>
      </Section>
      <Section title="4. Jobs, prices and payments">
        <ul className="pub-list">
          <li>The seeker and provider agree the job, price and time between themselves. The provider sets the price of a listed service.</li>
          <li><b>Direct payments</b> (cash, or Nagad sent to the provider) are between the seeker and the provider. MicroServiceHub does not hold that money and takes no fee on it.</li>
          <li><b>Online payments</b> are collected by MicroServiceHub and held in escrow. They are released to the provider after the seeker marks the job complete, or after an admin decides a dispute. A service fee may be added to the price and is shown before you pay. The provider receives the full agreed price.</li>
          <li>Promo and referral codes have no cash value, may expire, and can be changed or withdrawn.</li>
        </ul>
      </Section>
      <Section title="5. Disputes">
        <p>If a job goes wrong, either person can open a dispute from the payment screen. An admin reviews what both sides say and may release held money to the provider, refund it to the seeker, or close the dispute. Our decision about money held on the platform is final within MicroServiceHub. It does not take away anyone's legal rights.</p>
      </Section>
      <Section title="6. Responsibility">
        <p>Providers are independent. We check identities but we cannot guarantee the quality, safety or legality of any job, or that a provider or seeker will behave as agreed. To the extent the law allows, MicroServiceHub is not liable for losses that come from a job arranged through the platform, apart from money we are holding for you.</p>
      </Section>
      <Section title="7. Suspension and ending">
        <p>You can stop using MicroServiceHub at any time. We may suspend or remove accounts or content that break these terms or put others at risk. Money held for completed or disputed jobs is still handled as described above.</p>
      </Section>
      <Section title="8. Changes">
        <p>We may update these terms. If the change is important we will tell you in the app. Using the service after a change means you accept it.</p>
      </Section>
      <Section title="9. Contact">
        <p>Questions about these terms? <Link to="/contact">Contact us</Link>.</p>
      </Section>
    </PublicShell>
  );
}

export function Privacy() {
  return (
    <PublicShell title="Privacy policy" intro={`Last updated ${UPDATED}. This explains what we collect and how we protect it.`}>
      <Section title="What we collect">
        <ul className="pub-list">
          <li><b>Account details:</b> name, email, phone number, password (stored only as a one-way hash), and your role.</li>
          <li><b>Identity verification:</b> your name and date of birth, your National ID number and photos of your NID (front and back), or if you are under 18 your birth certificate number and a photo of it, plus a selfie.</li>
          <li><b>Activity:</b> work posts, listings, applications, bookings, messages, reviews, payments and reports.</li>
          <li><b>Location:</b> only when you choose to share your live location during a job. It stops when you stop sharing, or by itself after two hours. The person you share with can see it, and so can MicroServiceHub admins, who use it only to keep people safe and to help in an emergency or a dispute. Providers can also switch on "Available now". Then an approximate location (rounded to about 500 metres, never the exact spot) is shown to seekers on a map while the provider has the app open. After the app is closed, the last approximate spot stays on the map as "last seen" for up to 3 hours and is then removed. The provider can switch it off at any time and it disappears at once.</li>
          <li><b>Blood donor details:</b> if you join the donor list, your blood group, area, and the date you last gave blood. Your phone number is shown only if you choose to share it, or to a family you offer to help. You can leave the list at any time and the record is deleted.</li>
          <li><b>Payment details:</b> Nagad numbers you save, and transaction IDs. We never see or store your PIN or OTP.</li>
          <li><b>Device and notifications:</b> if you allow phone alerts, a push subscription so we can notify you.</li>
        </ul>
      </Section>
      <Section title="Why we use it">
        <ul className="pub-list">
          <li>To run the marketplace: matching, chat, calls, payments, payouts and disputes.</li>
          <li>To keep the community safe: identity checks, preventing fraud and handling reports.</li>
          <li>To contact you about your account, jobs and payments, by notification, email or SMS depending on your settings.</li>
        </ul>
      </Section>
      <Section title="Who can see your information">
        <ul className="pub-list">
          <li><b>Your NID or birth certificate details and photos</b> are visible only to you and to MicroServiceHub admins who review them. They are never shown to other users.</li>
          <li>Other users see your name, role, the reviews written about you, an ID-verified badge, and what you choose to put on your listings and profile. Your phone number is shown only if you allow it.</li>
          <li>When you share live location, the other person on that job can see it, and MicroServiceHub admins can see it too while you share.</li>
          <li>We do not sell your personal information. We share it only with service providers that help us run the platform (for example email, SMS and payment services) and when the law requires it.</li>
        </ul>
      </Section>
      <Section title="How we protect it">
        <p>Passwords are hashed. Access to identity documents is limited and checked on the server on every request. Connections to the site use HTTPS. No system is perfectly secure, so please use a strong, unique password.</p>
      </Section>
      <Section title="Your choices">
        <ul className="pub-list">
          <li>Change your profile details, notification choices and payment numbers in your profile and settings.</li>
          <li>Turn off live location, phone alerts, email or SMS at any time.</li>
          <li>Ask us to correct or delete your data from the <Link to="/contact">Contact page</Link>. We may need to keep some records about completed jobs and payments for legal and fraud-prevention reasons.</li>
        </ul>
      </Section>
      <Section title="Keeping data">
        <p>We keep account data while your account is open. Identity documents and payment records are kept as long as needed for safety, disputes and legal duties.</p>
      </Section>
      <Section title="Changes and contact">
        <p>We will tell you in the app about important changes to this policy. Questions? <Link to="/contact">Contact us</Link>.</p>
      </Section>
    </PublicShell>
  );
}
