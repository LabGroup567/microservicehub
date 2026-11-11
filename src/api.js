// In development the API runs on port 5000. A production build that the backend serves itself
// talks to the same address the page came from; set VITE_API_URL to host the site elsewhere.
export const API_ORIGIN = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
).replace(/\/$/, '');

export const API = `${API_ORIGIN}/api`;

/** Public address of an uploaded photo (work and service photos). */
export const imageUrl = (id) => `${API}/images/${id}`;

const SESSION_KEY = 'microservicehub-session';

export function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return session?.token && session?.user ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the session just won't survive a refresh.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Calls the backend with the saved login token and returns the parsed JSON.
 * Throws an Error whose message is safe to show to the user.
 */
export async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  const token = readSession()?.token;

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the server. Please check that the backend is running.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response; handled below.
  }

  if (response.status === 401 && auth && token) {
    clearSession();
    window.dispatchEvent(new Event('mh:unauthorized'));
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message || 'Request failed. Please try again.');
  }

  return data;
}

export function formatMoney(value) {
  return `BDT ${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** "Closes in 5 days" for open work that will expire, or null when there is nothing to say. */
export function closesIn(value) {
  if (!value) return null;
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
  if (days <= 0) return 'Expired';
  if (days === 1) return 'Closes tomorrow';
  return `Closes in ${days} days`;
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}
