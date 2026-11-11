import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_ORIGIN, readSession } from './api.js';
import { useAuth } from './auth.jsx';

const RealtimeContext = createContext({
  socket: null,
  connected: false,
  sharingTo: [],
  myPosition: null,
  geoError: '',
  startSharing: async () => ({ ok: false }),
  stopSharing: () => {},
});

/**
 * Owns the live socket connection and the device's location watch, so a live
 * location share keeps running while the user moves between pages.
 */
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [sharingTo, setSharingTo] = useState([]);
  const [myPosition, setMyPosition] = useState(null);
  const [geoError, setGeoError] = useState('');

  const watchRef = useRef(null);
  const sharingRef = useRef(new Set());

  const stopWatchIfIdle = useCallback(() => {
    if (sharingRef.current.size === 0 && watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setMyPosition(null);
    }
  }, []);

  // One connection per logged-in user.
  useEffect(() => {
    if (!userId) return undefined;

    const token = readSession()?.token;
    const connection = io(API_ORIGIN, { auth: { token } });

    connection.on('connect', () => setConnected(true));
    connection.on('disconnect', () => setConnected(false));
    setSocket(connection);

    const sharing = sharingRef.current;

    return () => {
      sharing.forEach((peerId) => connection.emit('location:stop', { to: peerId }));
      sharing.clear();

      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }

      connection.close();
      setSocket(null);
      setConnected(false);
      setSharingTo([]);
      setMyPosition(null);
    };
  }, [userId]);

  const startSharing = useCallback(
    async (peerId) => {
      if (!socket) return { ok: false, message: 'Not connected. Please try again.' };
      if (!navigator.geolocation) {
        return { ok: false, message: 'This device does not support location.' };
      }
      if (!window.isSecureContext) {
        return { ok: false, message: 'Location needs a secure (HTTPS) connection.' };
      }

      setGeoError('');

      const result = await new Promise((resolve) => socket.emit('location:start', { to: peerId }, resolve));
      if (!result?.ok) return result || { ok: false, message: 'Could not start sharing.' };

      sharingRef.current.add(peerId);
      setSharingTo([...sharingRef.current]);

      if (watchRef.current === null) {
        watchRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            setMyPosition({ lat: latitude, lng: longitude, accuracy });
            setGeoError('');

            sharingRef.current.forEach((id) =>
              socket.emit('location:update', { to: id, lat: latitude, lng: longitude, accuracy })
            );
          },
          (error) => {
            setGeoError(
              error.code === 1
                ? 'Location permission was denied. Allow it in your browser settings.'
                : 'Could not get your location.'
            );
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
      }

      return { ok: true, expires_at: result.expires_at };
    },
    [socket]
  );

  const stopSharing = useCallback(
    (peerId) => {
      if (socket) socket.emit('location:stop', { to: peerId });
      sharingRef.current.delete(peerId);
      setSharingTo([...sharingRef.current]);
      stopWatchIfIdle();
    },
    [socket, stopWatchIfIdle]
  );

  const value = useMemo(
    () => ({ socket, connected, sharingTo, myPosition, geoError, startSharing, stopSharing }),
    [socket, connected, sharingTo, myPosition, geoError, startSharing, stopSharing]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
