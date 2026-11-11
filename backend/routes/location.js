const express = require('express');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { fail, toId, canChat } = require('../helpers');
const { getShare, publicShare, activeShares } = require('../realtime');

const router = express.Router();

// Current live-location state between me and another user.
router.get('/location/:userId', requireAuth, async (req, res) => {
  const peerId = toId(req.params.userId);
  if (!peerId) fail(400, 'Invalid user.');

  const [rows] = await db.query(
    'SELECT id, full_name, role, is_banned FROM users WHERE id = ?',
    [peerId]
  );
  const peer = rows[0];
  if (!peer || peer.is_banned) fail(404, 'User not found.');
  if (!(await canChat(req.user, peer))) fail(403, 'You cannot view this location.');

  const theirs = getShare(peer.id, req.user.id);
  const mine = getShare(req.user.id, peer.id);

  res.json({
    success: true,
    peer: theirs ? publicShare(theirs) : { active: false },
    mine: mine ? publicShare(mine) : { active: false },
  });
});

// Admins can see every live share, for safety. Users are told this in the privacy policy.
router.get('/admin/locations', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ success: true, shares: activeShares() });
});

module.exports = router;
