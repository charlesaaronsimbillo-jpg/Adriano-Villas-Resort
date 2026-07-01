const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const BlockedDate = require('../models/BlockedDate');
const Message = require('../models/Message');
const axios = require('axios');

// No-cache headers for all admin routes
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ── EMAIL HELPER (Brevo) ───────────────────────────────────────────────────────
async function sendEmail({ toEmail, toName, subject, htmlContent }) {
  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: {
        name: process.env.SENDER_NAME || 'Adriano Villas & Resort',
        email: process.env.SENDER_EMAIL,
      },
      to: [{ email: toEmail, name: toName }],
      subject,
      htmlContent,
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adriano2026';

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/admin/check
router.get('/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────
// GET /api/admin/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [totalBookings, pending, approved, rejected, cancelled, unreadMessages, totalMessages] = await Promise.all([
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'pending' }),
      Booking.countDocuments({ status: 'approved' }),
      Booking.countDocuments({ status: 'rejected' }),
      Booking.countDocuments({ status: 'cancelled' }),
      Message.countDocuments({ read: false }),
      Message.countDocuments()
    ]);

    // Revenue from approved bookings (rate stored per unit)
    const UNIT_RATES = {
      'Ocean View Villa':   28200,
      'Mountain View Villa': 28200,
      'Cabana 1': 6500,
      'Cabana 2': 6500,
      'Cabana 3': 6500,
      'The Cabin': 10600,
    };
    const approvedBookings = await Booking.find({ status: 'approved' }, 'checkIn checkOut roomType');
    const totalRevenue = approvedBookings.reduce((sum, b) => {
      const nights = Math.round((new Date(b.checkOut) - new Date(b.checkIn)) / 86400000);
      const rate   = UNIT_RATES[b.roomType] || 0;
      return sum + nights * rate;
    }, 0);

    // Bookings per unit
    const unitBreakdown = await Booking.aggregate([
      { $group: { _id: '$roomType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({ totalBookings, pending, approved, rejected, cancelled, unreadMessages, totalMessages, totalRevenue, unitBreakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BOOKINGS ──────────────────────────────────────────────────────────────────
// GET /api/admin/bookings
router.get('/bookings', requireAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status)   filter.status   = req.query.status;
    if (req.query.roomType) filter.roomType = req.query.roomType;
    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/bookings/manual — admin adds a booking directly
router.post('/bookings/manual', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, roomType, checkIn, checkOut, guests, status, message, adminNotes } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const start = checkIn  ? new Date(checkIn)  : new Date();
    const end   = checkOut ? new Date(checkOut) : new Date();

    if (isNaN(start) || isNaN(end)) {
      return res.status(400).json({ error: 'Invalid dates provided.' });
    }

    const bookingStatus = status || 'approved';

    // Per-unit overlap check
    if (bookingStatus === 'approved' && roomType && roomType !== 'Not selected') {
      const overlap = await Booking.findOne({
        status: 'approved',
        roomType,
        checkIn:  { $lt: end },
        checkOut: { $gt: start },
        $expr: {
          $and: [
            { $ne: ['$checkOut', end] },
            { $ne: ['$checkIn', end] }
          ]
        }
      });
      if (overlap) {
        const name = `${overlap.firstName} ${overlap.lastName}`;
        const ci   = new Date(overlap.checkIn).toDateString();
        const co   = new Date(overlap.checkOut).toDateString();
        return res.status(400).json({
          error: `Dates conflict with existing booking by ${name} (${ci} → ${co}).`
        });
      }
    }

    const booking = new Booking({
      firstName, lastName, email, phone,
      checkIn: start, checkOut: end,
      roomType: roomType || 'Not selected',
      guests: guests || 1,
      message: message || '',
      adminNotes: adminNotes || 'Manual booking added by admin',
      status: bookingStatus
    });
    await booking.save();

    // ✉️ Email guest
    try {
      await sendEmail({
        toEmail: email,
        toName:  `${firstName} ${lastName}`,
        subject: 'Booking Confirmed – Adriano Villas & Resort 🏝️',
        htmlContent: buildConfirmationEmail({ firstName, lastName, roomType, start, end, message, status: bookingStatus }),
      });
    } catch (emailErr) {
      console.error('⚠️ Manual booking email failed:', emailErr?.response?.data || emailErr.message);
    }

    res.status(201).json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/bookings/:id — update status or notes
router.patch('/bookings/:id', requireAuth, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const update = {};
    if (status     !== undefined) update.status     = status;
    if (adminNotes !== undefined) update.adminNotes = adminNotes;

    const booking = await Booking.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // ✉️ Email on approval or rejection
    if (status === 'approved' || status === 'rejected' || status === 'cancelled') {
      try {
        const subject = status === 'approved'
          ? 'Your Reservation is Confirmed! 🎉 – Adriano Villas & Resort'
          : status === 'rejected'
          ? 'Update on Your Booking – Adriano Villas & Resort'
          : 'Booking Cancellation – Adriano Villas & Resort';

        await sendEmail({
          toEmail: booking.email,
          toName:  `${booking.firstName} ${booking.lastName}`,
          subject,
          htmlContent: buildStatusEmail(booking, status),
        });
      } catch (emailErr) {
        console.error('⚠️ Status email failed:', emailErr?.response?.data || emailErr.message);
      }
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/bookings/:id
router.delete('/bookings/:id', requireAuth, async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BLOCKED DATES ─────────────────────────────────────────────────────────────
router.get('/blocked', requireAuth, async (req, res) => {
  try {
    const dates = await BlockedDate.find().sort({ date: 1 });
    res.json(dates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/blocked', requireAuth, async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Date is required.' });
    const blocked = new BlockedDate({ date: new Date(date), reason: reason || 'Unavailable' });
    await blocked.save();
    res.status(201).json(blocked);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'That date is already blocked.' });
    res.status(400).json({ error: err.message });
  }
});

router.delete('/blocked/:id', requireAuth, async (req, res) => {
  try {
    await BlockedDate.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────
router.get('/messages', requireAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.unread === 'true') filter.read = false;
    const messages = await Message.find(filter).sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/messages/:id/read', requireAuth, async (req, res) => {
  try {
    const msg = await Message.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/messages/:id', requireAuth, async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────────────
function emailWrapper(bodyHtml) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #d6c9a0;border-radius:12px;overflow:hidden;">
      <div style="background:#0d1b2a;padding:28px 24px;text-align:center;">
        <h1 style="color:#c9a96e;margin:0;font-size:22px;letter-spacing:2px;">ADRIANO VILLAS</h1>
        <p style="color:#8a9bb0;margin:6px 0 0;font-size:12px;letter-spacing:3px;text-transform:uppercase;">&amp; Resort · Morong, Bataan</p>
      </div>
      <div style="padding:28px 28px 20px;background:#fff;">
        ${bodyHtml}
        <div style="background:#fff8e1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;margin:24px 0;">
          <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📞 Contact Us</h3>
          <p style="margin:4px 0;font-size:14px;color:#333;"><strong>Location:</strong> Turtle Crossing, The Strand Subdivision, Morong, Bataan</p>
          <p style="margin:4px 0;font-size:14px;color:#333;"><strong>Email:</strong> reservations@adrianovillas.com</p>
        </div>
        <p style="color:#333;line-height:1.7;">For any concerns, don't hesitate to reach out. We're always happy to help! 🙏</p>
      </div>
      <div style="background:#f5f5f5;padding:16px 28px;border-top:1px solid #e0e0e0;text-align:center;">
        <p style="margin:0;font-size:13px;color:#555;">Warm regards, <strong>The Adriano Villas &amp; Resort Team 🏝️</strong></p>
        <p style="margin:8px 0 0;font-size:11px;color:#999;">This is an automated email. Please do not reply to this message.</p>
      </div>
    </div>
  `;
}

function buildConfirmationEmail({ firstName, lastName, roomType, start, end, message }) {
  const ci = start ? new Date(start).toDateString() : 'Not specified';
  const co = end   ? new Date(end).toDateString()   : 'Not specified';
  return emailWrapper(`
    <h2 style="color:#0d1b2a;margin-top:0;">Booking Confirmed, ${firstName}! 🎉</h2>
    <p style="color:#333;line-height:1.7;">
      Your booking at <strong>Adriano Villas &amp; Resort</strong> has been confirmed by our team.
      Please bring your payment confirmation on the day of your arrival. 😊
    </p>
    <div style="background:#f8f6f1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;margin:24px 0;">
      <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📋 Booking Details</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
        <tr><td style="padding:5px 0;font-weight:bold;width:130px;">Name</td><td>${firstName} ${lastName}</td></tr>
        <tr><td style="padding:5px 0;font-weight:bold;">Unit</td><td>${roomType || 'Not selected'}</td></tr>
        <tr><td style="padding:5px 0;font-weight:bold;">Check-in</td><td>${ci}</td></tr>
        <tr><td style="padding:5px 0;font-weight:bold;">Check-out</td><td>${co}</td></tr>
        <tr><td style="padding:5px 0;font-weight:bold;">Status</td><td style="color:#2e7d32;font-weight:bold;">✅ Confirmed</td></tr>
        ${message ? `<tr><td style="padding:5px 0;font-weight:bold;vertical-align:top;">Notes</td><td>${message}</td></tr>` : ''}
      </table>
    </div>
  `);
}

function buildStatusEmail(booking, status) {
  const firstName = booking.firstName;
  const lastName  = booking.lastName;
  const roomType  = booking.roomType;
  const ci = new Date(booking.checkIn).toDateString();
  const co = new Date(booking.checkOut).toDateString();

  if (status === 'approved') {
    return emailWrapper(`
      <h2 style="color:#0d1b2a;margin-top:0;">🎉 Great news, ${firstName}!</h2>
      <p style="color:#333;line-height:1.7;">
        Your reservation at <strong>Adriano Villas &amp; Resort</strong> has been <strong>confirmed!</strong>
        We're excited to welcome you. 🏝️✨
      </p>
      <p style="color:#333;line-height:1.7;">
        Please bring your payment confirmation on the day of your arrival.
        If you have special requests, feel free to reach out. 😊
      </p>
      <div style="background:#f8f6f1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;margin:24px 0;">
        <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📋 Booking Details</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
          <tr><td style="padding:5px 0;font-weight:bold;width:130px;">Name</td><td>${firstName} ${lastName}</td></tr>
          <tr><td style="padding:5px 0;font-weight:bold;">Unit</td><td>${roomType}</td></tr>
          <tr><td style="padding:5px 0;font-weight:bold;">Check-in</td><td>${ci}</td></tr>
          <tr><td style="padding:5px 0;font-weight:bold;">Check-out</td><td>${co}</td></tr>
          <tr><td style="padding:5px 0;font-weight:bold;">Status</td><td style="color:#2e7d32;font-weight:bold;">✅ Confirmed</td></tr>
        </table>
      </div>
    `);
  }

  if (status === 'rejected') {
    return emailWrapper(`
      <h2 style="color:#0d1b2a;margin-top:0;">Update on Your Booking, ${firstName}</h2>
      <p style="color:#333;line-height:1.7;">
        We're sorry to inform you that we're unable to accommodate your reservation for <strong>${roomType}</strong>
        (${ci} → ${co}) at this time.
      </p>
      <p style="color:#333;line-height:1.7;">
        This may be due to availability conflicts or other scheduling reasons.
        Please feel free to reach out to us to check for other available dates — we'd love to find a time that works! 🙏
      </p>
    `);
  }

  if (status === 'cancelled') {
    return emailWrapper(`
      <h2 style="color:#0d1b2a;margin-top:0;">Booking Cancellation Notice, ${firstName}</h2>
      <p style="color:#333;line-height:1.7;">
        Your reservation for <strong>${roomType}</strong> (${ci} → ${co}) has been <strong>cancelled</strong>.
      </p>
      <p style="color:#333;line-height:1.7;">
        If you believe this is a mistake or would like to rebook, please don't hesitate to contact us. We're happy to assist! 😊
      </p>
    `);
  }

  return emailWrapper(`<p>Your booking status has been updated to: <strong>${status}</strong>.</p>`);
}

module.exports = router;
