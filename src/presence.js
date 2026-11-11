import { useSyncExternalStore } from 'react';
import { apiFetch } from './api.js';

// "Available now" for providers. The page keeps sending the provider's approximate position
// once a minute while it is open; the server forgets it 15 minutes after the last update.

const PING_MS = 60 * 1000;

let state = { on: false, busy: false, error: '' };
let watchId = null;
let timer = null;
let last = null;
let lastSentAt = 0;
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function send() {
  if (!last || !state.on) return;
  lastSentAt = Date.now();
  try {
    await apiFetch('/presence', { method: 'PUT', body: { lat: last.lat, lng: last.lng } });
  } catch (err) {
    set({ error: err.message });
  }
}

// When the phone wakes up or the person comes back to the tab, say where they are at once.
function onVisible() {
  if (document.visibilityState === 'visible') send();
}

function startWatching() {
  stopWatching();
  if (!navigator.geolocation) return;
  document.addEventListener('visibilitychange', onVisible);

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      last = { lat: position.coords.latitude, lng: position.coords.longitude };
      // The first fix goes out at once; after that the timer takes over.
      if (Date.now() - lastSentAt > PING_MS) send();
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 30000 }
  );
  timer = window.setInterval(send, PING_MS);
}

function stopWatching() {
  document.removeEventListener('visibilitychange', onVisible);
  if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  window.clearInterval(timer);
  watchId = null;
  timer = null;
}

function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device cannot share its location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? 'Location is blocked. Allow location for this site in your browser settings, then try again.'
              : 'Your location could not be found. Check that location is on and try again.'
          )
        ),
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
    );
  });
}

/** Called once when a provider opens the app: carry on if they had it switched on. */
export async function resumePresence() {
  try {
    const me = await apiFetch('/presence/me');
    if (me.on) {
      set({ on: true, error: '' });
      startWatching();
    }
  } catch {
    // Not a provider, or offline: nothing to resume.
  }
}

/** Called when the app closes for this person. The server drops them by itself after 15 minutes. */
export function stopPresence() {
  stopWatching();
  last = null;
  lastSentAt = 0;
  set({ on: false, busy: false, error: '' });
}

export async function turnOnPresence() {
  set({ busy: true, error: '' });
  try {
    last = await readPosition();
    state = { ...state, on: true };
    await send();
    set({ on: true, busy: false });
    startWatching();
  } catch (err) {
    state = { ...state, on: false };
    set({ on: false, busy: false, error: err.message });
  }
}

export async function turnOffPresence() {
  set({ busy: true, error: '' });
  stopWatching();
  try {
    await apiFetch('/presence', { method: 'DELETE' });
    last = null;
    set({ on: false, busy: false });
  } catch (err) {
    set({ busy: false, error: err.message });
  }
}

export function usePresence() {
  return useSyncExternalStore(subscribe, () => state);
}
