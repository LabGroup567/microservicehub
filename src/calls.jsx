import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtime } from './realtime.jsx';
import Icon from './Icon.jsx';

const CallContext = createContext({ state: 'idle', startCall: async () => {} });

// STUN lets most phones and laptops connect directly. For strict networks add a TURN
// server through VITE_ICE_SERVERS, e.g. [{"urls":"turn:host:3478","username":"u","credential":"p"}].
function iceServers() {
  try {
    const custom = JSON.parse(import.meta.env.VITE_ICE_SERVERS);
    if (Array.isArray(custom) && custom.length) return custom;
  } catch {
    // Fall back to the public STUN server below.
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

const IDLE = { state: 'idle', peer: null, muted: false, message: '', startedAt: null };

const END_MESSAGES = {
  declined: 'declined the call.',
  no_answer: 'did not answer.',
  disconnected: 'lost connection.',
  ended: 'ended the call.',
};

function formatDuration(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function CallProvider({ children }) {
  const { socket } = useRealtime();
  const [call, setCall] = useState(IDLE);

  const stateRef = useRef('idle');
  const peerRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const pendingIce = useRef([]);
  const audioRef = useRef(null);
  const ringRef = useRef(null);
  const messageTimer = useRef(null);

  const update = useCallback((next) => {
    stateRef.current = next.state;
    peerRef.current = next.peer;
    setCall(next);
  }, []);

  // ---- Ringing sound (a soft beep pattern made with the Web Audio API) ----
  const stopRing = useCallback(() => {
    if (ringRef.current) {
      window.clearInterval(ringRef.current.timer);
      ringRef.current.context.close().catch(() => {});
      ringRef.current = null;
    }
  }, []);

  const startRing = useCallback(
    (frequency) => {
      stopRing();

      try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const beep = () => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = frequency;
          gain.gain.value = 0.05;
          oscillator.connect(gain).connect(context.destination);
          oscillator.start();
          oscillator.stop(context.currentTime + 0.35);
        };
        beep();
        ringRef.current = { context, timer: window.setInterval(beep, 1800) };
      } catch {
        // Sound is a nicety; the on-screen prompt still works.
      }
    },
    [stopRing]
  );

  const cleanup = useCallback(() => {
    stopRing();
    pendingIce.current = [];

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioRef.current) audioRef.current.srcObject = null;
  }, [stopRing]);

  const finish = useCallback(
    (message = '') => {
      cleanup();
      update({ ...IDLE, message });

      window.clearTimeout(messageTimer.current);
      if (message) {
        messageTimer.current = window.setTimeout(() => setCall((current) => (current.state === 'idle' ? IDLE : current)), 4500);
      }
    },
    [cleanup, update]
  );

  // ---- WebRTC ----
  const openMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      throw new Error('Calls need a secure (HTTPS) connection and a microphone.');
    }

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error('Microphone access was denied. Allow it in your browser settings.');
    }
  }, []);

  const createConnection = useCallback(
    (peerId) => {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      pcRef.current = pc;

      streamRef.current.getTracks().forEach((track) => pc.addTrack(track, streamRef.current));

      pc.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          audioRef.current.play().catch(() => {});
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('call:signal', { to: peerId, data: { candidate: event.candidate } });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          update({ ...call, state: 'active', peer: peerRef.current, startedAt: Date.now(), muted: false, message: '' });
        }
        if (pc.connectionState === 'failed') {
          socket.emit('call:end', { to: peerId });
          finish('The call could not connect. Check your network.');
        }
      };

      return pc;
    },
    // `call` is intentionally read at event time through update(); see onconnectionstatechange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socket, update, finish]
  );

  const startCall = useCallback(
    async (peer) => {
      if (!socket || stateRef.current !== 'idle') return;

      window.clearTimeout(messageTimer.current);

      try {
        await openMicrophone();
      } catch (error) {
        finish(error.message);
        return;
      }

      update({ ...IDLE, state: 'calling', peer });
      startRing(440);

      const result = await new Promise((resolve) => socket.emit('call:invite', { to: peer.id }, resolve));

      if (!result?.ok) {
        finish(result?.message || 'Could not place the call.');
      }
    },
    [socket, openMicrophone, update, startRing, finish]
  );

  const accept = useCallback(async () => {
    const peer = peerRef.current;
    if (!socket || !peer || stateRef.current !== 'incoming') return;

    stopRing();

    try {
      await openMicrophone();
    } catch (error) {
      socket.emit('call:decline', { to: peer.id });
      finish(error.message);
      return;
    }

    createConnection(peer.id);
    update({ ...IDLE, state: 'connecting', peer });
    socket.emit('call:accept', { to: peer.id });
  }, [socket, stopRing, openMicrophone, createConnection, update, finish]);

  const decline = useCallback(() => {
    const peer = peerRef.current;
    if (socket && peer) socket.emit('call:decline', { to: peer.id });
    finish();
  }, [socket, finish]);

  const hangUp = useCallback(() => {
    const peer = peerRef.current;
    if (socket && peer) socket.emit('call:end', { to: peer.id });
    finish();
  }, [socket, finish]);

  const toggleMute = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setCall((current) => ({ ...current, muted: !track.enabled }));
  }, []);

  // ---- Socket events ----
  useEffect(() => {
    if (!socket) return undefined;

    const onIncoming = ({ from, name }) => {
      if (stateRef.current !== 'idle') return;

      window.clearTimeout(messageTimer.current);
      update({ ...IDLE, state: 'incoming', peer: { id: from, full_name: name } });
      startRing(520);
    };

    const onAccepted = async ({ from }) => {
      if (stateRef.current !== 'calling' || from !== peerRef.current?.id) return;

      stopRing();
      update({ ...IDLE, state: 'connecting', peer: peerRef.current });

      try {
        const pc = createConnection(from);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:signal', { to: from, data: { sdp: pc.localDescription } });
      } catch {
        socket.emit('call:end', { to: from });
        finish('The call could not start.');
      }
    };

    const onSignal = async ({ from, data }) => {
      const pc = pcRef.current;
      if (!pc || from !== peerRef.current?.id) return;

      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);

          for (const candidate of pendingIce.current) await pc.addIceCandidate(candidate);
          pendingIce.current = [];

          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('call:signal', { to: from, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else pendingIce.current.push(data.candidate);
        }
      } catch {
        // A bad candidate should not drop the whole call.
      }
    };

    const onEnded = ({ from, reason }) => {
      if (stateRef.current === 'idle') return;
      if (from !== peerRef.current?.id) return;

      const name = peerRef.current?.full_name || 'The other person';
      finish(`${name} ${END_MESSAGES[reason] || 'ended the call.'}`);
    };

    // Another tab or device of mine already answered this call.
    const onHandled = () => {
      if (stateRef.current === 'incoming') finish();
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:ended', onEnded);
    socket.on('call:handled', onHandled);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:ended', onEnded);
      socket.off('call:handled', onHandled);
    };
  }, [socket, update, startRing, stopRing, createConnection, finish]);

  // Leaving or losing the socket ends any call on this side.
  useEffect(() => () => cleanup(), [socket, cleanup]);

  const value = useMemo(() => ({ state: call.state, startCall }), [call.state, startCall]);

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio ref={audioRef} autoPlay playsInline />
      <CallOverlay call={call} accept={accept} decline={decline} hangUp={hangUp} toggleMute={toggleMute} />
    </CallContext.Provider>
  );
}

function CallOverlay({ call, accept, decline, hangUp, toggleMute }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (call.state !== 'active' || !call.startedAt) return undefined;

    const tick = () => setSeconds(Math.floor((Date.now() - call.startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [call.state, call.startedAt]);

  if (call.state === 'idle' && !call.message) return null;

  if (call.state === 'idle') {
    return (
      <div className="call call-note" role="status">
        {call.message}
      </div>
    );
  }

  const name = call.peer?.full_name || 'Unknown';

  return (
    <div className={`call ${call.state}`} role="dialog" aria-label="Voice call">
      <span className="call-avatar">{name.charAt(0).toUpperCase()}</span>

      <div className="call-info">
        <strong>{name}</strong>
        <small>
          {call.state === 'incoming' && 'Incoming voice call...'}
          {call.state === 'calling' && 'Calling...'}
          {call.state === 'connecting' && 'Connecting...'}
          {call.state === 'active' && `In call · ${formatDuration(seconds)}`}
        </small>
      </div>

      <div className="call-actions">
        {call.state === 'incoming' && (
          <>
            <button className="call-btn accept" onClick={accept} aria-label="Accept call">
              <Icon name="phone" />
            </button>
            <button className="call-btn end" onClick={decline} aria-label="Decline call">
              <Icon name="x" />
            </button>
          </>
        )}

        {call.state === 'active' && (
          <button className={`call-btn mute ${call.muted ? 'on' : ''}`} onClick={toggleMute} aria-label={call.muted ? 'Unmute' : 'Mute'}>
            {call.muted ? <Icon name="mic-off" /> : <Icon name="mic" />}
          </button>
        )}

        {(call.state === 'calling' || call.state === 'connecting' || call.state === 'active') && (
          <button className="call-btn end" onClick={hangUp} aria-label="End call">
            <Icon name="x" />
          </button>
        )}
      </div>
    </div>
  );
}

export function useCall() {
  return useContext(CallContext);
}

/** Starts an in-app voice call with `peer` ({ id, full_name }). */
export function CallButton({ peer, label = <><Icon name="phone" /> Call</> }) {
  const { state, startCall } = useCall();

  return (
    <button className="btn btn-soft btn-sm" onClick={() => startCall(peer)} disabled={state !== 'idle'}>
      {label}
    </button>
  );
}
