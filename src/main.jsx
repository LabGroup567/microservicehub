import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';

import './index.css';
import './features.css';
import './pages.css';

import { AuthProvider, useAuth } from './auth.jsx';
import { applyTheme, getTheme } from './theme.js';
import { RealtimeProvider } from './realtime.jsx';
import { CallProvider } from './calls.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import Layout from './Layout.jsx';
import NotFound from './NotFound.jsx';
import { Loading } from './ui.jsx';
import Login from './Login.jsx';
import Register from './Register.jsx';
const App = lazy(() => import('./App.jsx'));
const Profile = lazy(() => import('./Profile.jsx'));
const ProviderProfile = lazy(() => import('./ProviderProfile.jsx'));
const Notifications = lazy(() => import('./Notifications.jsx'));
const Messages = lazy(() => import('./Messages.jsx'));
const AddWork = lazy(() => import('./AddWork.jsx'));
const MyWork = lazy(() => import('./MyWork.jsx'));
const WorkDetail = lazy(() => import('./WorkDetail.jsx'));
const MyBookings = lazy(() => import('./MyBookings.jsx'));
const ProviderServices = lazy(() => import('./ProviderServices.jsx'));
const Services = lazy(() => import('./Services.jsx'));
const MyApplications = lazy(() => import('./MyApplications.jsx'));
const MyServices = lazy(() => import('./MyServices.jsx'));
const ProviderBookings = lazy(() => import('./ProviderBookings.jsx'));
const Admin = lazy(() => import('./Admin.jsx'));
const Kyc = lazy(() => import('./Kyc.jsx'));
const Payments = lazy(() => import('./Payments.jsx'));
const Support = lazy(() => import('./Support.jsx'));
const Disputes = lazy(() => import('./Disputes.jsx'));
const Referrals = lazy(() => import('./Referrals.jsx'));
import { ForgotPassword, ResetPassword, VerifyEmail } from './AccountPages.jsx';
import { About, Contact, Help, HowItWorks, Privacy, Safety, Terms } from './Public.jsx';
import './mobile.css';
const Landing = lazy(() => import('./Landing.jsx'));
const Earnings = lazy(() => import('./Earnings.jsx'));
const Favorites = lazy(() => import('./Favorites.jsx'));
const Nearby = lazy(() => import('./Nearby.jsx'));
const Explore = lazy(() => import('./Explore.jsx'));
const Emergency = lazy(() => import('./Emergency.jsx'));
const Blood = lazy(() => import('./Blood.jsx'));
const Ambulances = lazy(() => import('./Ambulances.jsx'));
const AmbulanceTrack = lazy(() => import('./AmbulanceTrack.jsx'));
const Doctors = lazy(() => import('./Doctors.jsx'));
const DriverTrack = lazy(() => import('./DriverTrack.jsx'));
const ExploreCategory = lazy(() => import('./ExploreCategory.jsx'));

function RequireAuth() {
  const { user } = useAuth();
  return user ? <Layout /> : <Navigate to="/login" replace />;
}

// Pages load on demand, so the first screen stays small and fast.
function Page({ children }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="pg"><Loading /></div>}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function RequireRole({ role }) {
  const { user } = useAuth();
  return user.role === role ? <Outlet /> : <Navigate to="/" replace />;
}

function Home() {
  const { user } = useAuth();
  return user.role === 'admin' ? <Navigate to="/admin" replace /> : <Page><App /></Page>;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : children;
}

function Main() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        <Route path="/track/:token" element={<Page><DriverTrack /></Page>} />
        <Route path="/welcome" element={<Page><Landing /></Page>} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/help" element={<Help />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />

        <Route element={<RequireAuth />}>
          <Route index element={<Home />} />
          <Route path="nearby" element={<Page><Nearby /></Page>} />
          <Route path="emergency" element={<Page><Emergency /></Page>} />
          <Route path="emergency/ambulances" element={<Page><Ambulances /></Page>} />
          <Route path="emergency/ambulances/:id" element={<Page><AmbulanceTrack /></Page>} />
          <Route path="emergency/doctors" element={<Page><Doctors /></Page>} />
          <Route path="blood" element={<Page><Blood /></Page>} />
          <Route path="explore" element={<Page><Explore /></Page>} />
          <Route path="explore/:id" element={<Page><ExploreCategory /></Page>} />
          <Route path="profile" element={<Page><Profile /></Page>} />
          <Route path="providers/:id" element={<Page><ProviderProfile /></Page>} />
          <Route path="notifications" element={<Page><Notifications /></Page>} />
          <Route path="messages" element={<Page><Messages /></Page>} />
          <Route path="messages/:userId" element={<Page><Messages /></Page>} />
          <Route path="work/:id" element={<Page><WorkDetail /></Page>} />
          <Route path="kyc" element={<Page><Kyc /></Page>} />
          <Route path="payments" element={<Page><Payments /></Page>} />
          <Route path="support" element={<Page><Support /></Page>} />
          <Route path="disputes" element={<Page><Disputes /></Page>} />
          <Route path="referrals" element={<Page><Referrals /></Page>} />
          <Route path="provider-services" element={<Page><ProviderServices /></Page>} />
          <Route path="services" element={<Page><Services /></Page>} />

          <Route element={<RequireRole role="seeker" />}>
            <Route path="add-work" element={<Page><AddWork /></Page>} />
            <Route path="my-work" element={<Page><MyWork /></Page>} />
            <Route path="my-bookings" element={<Page><MyBookings /></Page>} />
            <Route path="favorites" element={<Page><Favorites /></Page>} />
          </Route>

          <Route element={<RequireRole role="provider" />}>
            <Route path="my-applications" element={<Page><MyApplications /></Page>} />
            <Route path="my-services" element={<Page><MyServices /></Page>} />
            <Route path="provider-bookings" element={<Page><ProviderBookings /></Page>} />
            <Route path="earnings" element={<Page><Earnings /></Page>} />
          </Route>

          <Route element={<RequireRole role="admin" />}>
            <Route path="admin" element={<Page><Admin /></Page>} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}

applyTheme(getTheme());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <RealtimeProvider>
        <CallProvider>
          <Main />
        </CallProvider>
      </RealtimeProvider>
    </AuthProvider>
  </StrictMode>
);
