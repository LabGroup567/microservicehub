const { Server } = require('socket.io');

const db = require('./db');
const { authenticateToken } = require('./auth');
const { canChat, toId, notify } = require('./helpers');

let io = null;

// Live location shares, kept in memory: "fromId:toId" -> share.
// A share ends when the user stops it, it expires, or the server restarts.
const shares = new Map();
const SHARE_MINUTES = 120;

// Voice calls: one entry per participant, both pointing at the same call object.
const calls = new Map();
const RING_SECONDS = 35;

const room = (userId) => `user:${userId}`;

// Admins watch every live share for safety. They join one room and get every update.
const ADMIN_ROOM = 'admins';
const emitToAdmins = (event, payload) => io?.to(ADMIN_ROOM).emit(event, payload);

function isOnline(userId) {
  return (io?.sockets.adapter.rooms.get(room(userId))?.size || 0) > 0;
}

function endCall(userId, reason) {
  const call = calls.get(userId);
  if (!call) return null;

  clearTimeout(call.timer);
  calls.delete(call.caller);
  calls.delete(call.callee);

  const other = call.caller === userId ? call.callee : call.caller;
  emitToUser(other, 'call:ended', { from: userId, reason });
  emitToUser(userId, 'call:ended', { from: other, reason });
  return call;
}

function emitToUser(userId, event, payload) {
  if (io && userId) io.to(room(userId)).emit(event, payload);
}

function getShare(fromId, toId_) {
  const key = `${fromId}:${toId_}`;
  const share = shares.get(key);

  if (share && share.expiresAt <= Date.now()) {
    shares.delete(key);
    return null;
  }
  return share || null;
}

function publicShare(share) {
  return {
    active: true,
    lat: share.lat,
    lng: share.lng,
    accuracy: share.accuracy,
    updated_at: share.updatedAt,
    expires_at: share.expiresAt,
  };
}

/** What an admin sees about one share: who shares with whom, and where. */
function adminShare(share) {
  return {
    from: share.fromId,
    from_name: share.fromName,
    from_role: share.fromRole,
    to: share.toId,
    to_name: share.toName,
    ...publicShare(share),
  };
}

/** Every live share right now (expired ones are dropped). */
function activeShares() {
  const list = [];
  for (const [key, share] of shares) {
    if (share.expiresAt <= Date.now()) {
      shares.delete(key);
    } else {
      list.push(adminShare(share));
    }
  }
  return list;
}

async function loadPeer(id) {
  const peerId = toId(id);
  if (!peerId) return null;

  const [rows] = await db.query(
    'SELECT id, full_name, role, is_banned FROM users WHERE id = ?',
    [peerId]
  );
  return rows.length && !rows[0].is_banned ? rows[0] : null;
}

function init(httpServer, origins) {
  io = new Server(httpServer, { cors: { origin: origins } });

  io.use(async (socket, next) => {
    try {
      const user = await authenticateToken(socket.handshake.auth?.token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(room(me.id));
    if (me.role === 'admin') socket.join(ADMIN_ROOM);

    let lastUpdate = 0;

    // ---- Typing indicator ----
    socket.on('typing', (payload) => {
      const to = toId(payload?.to);
      if (to) emitToUser(to, 'typing', { from: me.id });
    });

    // ---- Live location ----
    socket.on('location:start', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};

      try {
        const peer = await loadPeer(payload?.to);
        if (!peer || !(await canChat(me, peer))) {
          return reply({ ok: false, message: 'You can share location after working together.' });
        }

        const existing = getShare(me.id, peer.id);
        const isNew = !existing;
        const share = existing || {
          fromId: me.id,
          fromName: me.full_name,
          fromRole: me.role,
          toId: peer.id,
          toName: peer.full_name,
          lat: null,
          lng: null,
          accuracy: null,
          updatedAt: null,
          expiresAt: Date.now() + SHARE_MINUTES * 60 * 1000,
        };
        shares.set(`${me.id}:${peer.id}`, share);
        emitToAdmins('admin:location', adminShare(share));

        emitToUser(peer.id, 'location:status', {
          from: me.id,
          name: me.full_name,
          active: true,
          ...publicShare(share),
        });
        if (isNew) {
          await notify(
            peer.id,
            'location_started',
            `${me.full_name} is sharing live location`,
            'Open the chat to see where they are.',
            `/messages/${me.id}`
          );
        }

        reply({ ok: true, expires_at: share.expiresAt });
      } catch {
        reply({ ok: false, message: 'Could not start sharing.' });
      }
    });

    socket.on('location:update', (payload) => {
      const to = toId(payload?.to);
      const lat = Number(payload?.lat);
      const lng = Number(payload?.lng);
      const now = Date.now();

      if (!to || now - lastUpdate < 1000) return;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

      // Updates only count while the user has an active share for this person.
      const share = getShare(me.id, to);
      if (!share) return;

      lastUpdate = now;
      share.lat = lat;
      share.lng = lng;
      share.accuracy = Number.isFinite(Number(payload.accuracy)) ? Number(payload.accuracy) : null;
      share.updatedAt = now;

      emitToUser(to, 'location:update', { from: me.id, name: me.full_name, ...publicShare(share) });
      emitToAdmins('admin:location', adminShare(share));
    });

    // ---- Voice calls (WebRTC signalling only; audio goes peer to peer) ----
    socket.on('call:invite', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};

      try {
        const peer = await loadPeer(payload?.to);
        if (!peer || !(await canChat(me, peer))) {
          return reply({ ok: false, message: 'You can call people you work with.' });
        }
        if (calls.has(me.id)) return reply({ ok: false, message: 'You are already in a call.' });
        if (calls.has(peer.id)) return reply({ ok: false, message: `${peer.full_name} is on another call.` });

        if (!isOnline(peer.id)) {
          await notify(peer.id, 'call_missed', `Missed call from ${me.full_name}`, '', `/messages/${me.id}`);
          return reply({ ok: false, message: `${peer.full_name} is offline. They will see a missed call.` });
        }

        const call = { caller: me.id, callee: peer.id, state: 'ringing', timer: null };
        call.timer = setTimeout(async () => {
          if (call.state !== 'ringing') return;
          endCall(me.id, 'no_answer');
          await notify(peer.id, 'call_missed', `Missed call from ${me.full_name}`, '', `/messages/${me.id}`).catch(() => {});
        }, RING_SECONDS * 1000);

        calls.set(me.id, call);
        calls.set(peer.id, call);

        emitToUser(peer.id, 'call:incoming', { from: me.id, name: me.full_name });
        reply({ ok: true });
      } catch {
        reply({ ok: false, message: 'Could not place the call.' });
      }
    });

    socket.on('call:accept', (payload) => {
      const call = calls.get(me.id);
      if (!call || call.callee !== me.id || call.state !== 'ringing') return;
      if (toId(payload?.to) !== call.caller) return;

      clearTimeout(call.timer);
      call.state = 'active';

      emitToUser(call.caller, 'call:accepted', { from: me.id });
      // Dismiss the ringing prompt on the callee's other tabs and devices.
      socket.to(room(me.id)).emit('call:handled');
    });

    socket.on('call:decline', () => {
      const call = calls.get(me.id);
      if (call && call.callee === me.id && call.state === 'ringing') endCall(me.id, 'declined');
    });

    socket.on('call:end', async () => {
      const call = calls.get(me.id);
      if (!call) return;

      const missed = call.state === 'ringing' && call.caller === me.id;
      endCall(me.id, 'ended');

      if (missed) {
        await notify(call.callee, 'call_missed', `Missed call from ${me.full_name}`, '', `/messages/${me.id}`).catch(() => {});
      }
    });

    socket.on('call:signal', (payload) => {
      const call = calls.get(me.id);
      if (!call || call.state !== 'active') return;

      const other = call.caller === me.id ? call.callee : call.caller;
      if (toId(payload?.to) !== other) return;
      if (!payload.data || JSON.stringify(payload.data).length > 20000) return;

      emitToUser(other, 'call:signal', { from: me.id, data: payload.data });
    });

    socket.on('disconnect', () => {
      // The last tab closing ends any call this user was in.
      if (!isOnline(me.id)) endCall(me.id, 'disconnected');
    });

    socket.on('location:stop', (payload) => {
      const to = toId(payload?.to);
      if (!to) return;

      shares.delete(`${me.id}:${to}`);
      emitToUser(to, 'location:status', { from: me.id, active: false });
      emitToAdmins('admin:location', { from: me.id, to, active: false });
    });
  });

  return io;
}

module.exports = { init, emitToUser, getShare, publicShare, activeShares };
