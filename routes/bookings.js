const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const BlockedDate = require('../models/BlockedDate');
const Message = require('../models/Message');
const axios = require('axios');

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

// ── REF NUMBER GENERATOR ─────────────────────────────────────────────────────
// Format: AV-YYYYMMDD-XXXXX (e.g. AV-20260611-A3K7F)
function generateRef() {
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars like 0/O 1/I
  let random = '';
  for (let i = 0; i < 5; i++) random += chars[Math.floor(Math.random() * chars.length)];
  return `AV-${dateStr}-${random}`;
}

// ── POST /api/bookings — submit a booking inquiry ────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, checkIn, checkOut, roomType, guests, message } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    let start, end;
    if (checkIn && checkOut) {
      start = new Date(checkIn);
      end   = new Date(checkOut);
      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ error: 'Invalid dates provided.' });
      }
      if (end <= start) {
        return res.status(400).json({ error: 'Check-out must be after check-in.' });
      }

      // Check globally blocked dates
      const blocked = await BlockedDate.findOne({ date: { $gte: start, $lt: end } });
      if (blocked) {
        return res.status(400).json({ error: 'Some dates in your range are unavailable.' });
      }

      // Check per-unit overlap — each unit has its own availability
      // Two different units can be booked on the same dates (e.g. Cabana 1 & Cabana 2)
      if (roomType && roomType !== 'Not selected') {
        const overlap = await Booking.findOne({
          status: 'approved',
          roomType,                          // same unit only
          checkIn:  { $lt: end },
          checkOut: { $gt: start }
        });
        if (overlap) {
          return res.status(400).json({ error: `${roomType} is already booked for those dates.` });
        }
      }
    }

    const booking = new Booking({
      refNumber: generateRef(),
      firstName, lastName, email, phone,
      checkIn:  start || new Date(),
      checkOut: end   || new Date(),
      roomType: roomType || 'Not selected',
      guests:   guests || 1,
      message
    });
    await booking.save();

    // ✅ Respond immediately — don't make the guest wait for emails
    res.status(201).json({ success: true, message: 'Booking inquiry received!', booking });

    // 🔔 Push notification (background)
    try {
      const adminToken = process.env.ADMIN_DEVICE_TOKEN;
      if (adminToken && global.firebaseAdmin) {
        await global.firebaseAdmin.messaging().send({
          token: adminToken,
          notification: {
            title: '🏝️ New Booking Inquiry!',
            body: `${firstName} ${lastName} just inquired for ${roomType || 'a unit'}!`,
          },
          android: { priority: 'high', notification: { sound: 'default' } }
        });
      }
    } catch (notifErr) {
      console.error('⚠️ Push notification failed:', notifErr.message);
    }

    // ✉️ Confirmation email to guest (background)
    try {
      const checkInFmt  = start ? start.toDateString() : 'Not specified';
      const checkOutFmt = end   ? end.toDateString()   : 'Not specified';

      await sendEmail({
        toEmail: email,
        toName:  `${firstName} ${lastName}`,
        subject: 'Booking Inquiry Received – Adriano Villas & Resort 🏝️',
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #d6c9a0;border-radius:12px;overflow:hidden;">

            <div style="background:#0d1b2a;padding:28px 24px;text-align:center;">
              <h1 style="color:#c9a96e;margin:0;font-size:22px;letter-spacing:2px;">ADRIANO VILLAS</h1>
              <p style="color:#8a9bb0;margin:6px 0 0;font-size:12px;letter-spacing:3px;text-transform:uppercase;">&amp; Resort · Morong, Bataan</p>
            </div>

            <div style="padding:28px 28px 20px;background:#fff;">
              <h2 style="color:#0d1b2a;margin-top:0;">Hi ${firstName}! 👋</h2>
              <p style="color:#333;line-height:1.7;">
                Thank you for reaching out to <strong>Adriano Villas &amp; Resort</strong>! 🎉
                We've received your booking inquiry and our team will get back to you shortly.
              </p>
              <p style="color:#333;line-height:1.7;">
                To <strong>confirm and secure your reservation</strong>, please message us on our Facebook page for payment details.
                We usually respond within <strong>24 hours</strong>. 😊
              </p>

              <div style="background:#f8f6f1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;margin:24px 0;">
                <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📋 Your Inquiry Details</h3>
                <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
                  <tr><td style="padding:5px 0;font-weight:bold;width:130px;">Name</td><td>${firstName} ${lastName}</td></tr>
                  <tr><td style="padding:5px 0;font-weight:bold;">Unit</td><td>${roomType || 'Not selected'}</td></tr>
                  <tr><td style="padding:5px 0;font-weight:bold;">Check-in</td><td>${checkInFmt}</td></tr>
                  <tr><td style="padding:5px 0;font-weight:bold;">Check-out</td><td>${checkOutFmt}</td></tr>
                  <tr><td style="padding:5px 0;font-weight:bold;">Guests</td><td>${guests || 1}</td></tr>
                  ${message ? `<tr><td style="padding:5px 0;font-weight:bold;vertical-align:top;">Message</td><td>${message}</td></tr>` : ''}
                </table>
              </div>

              <div style="background:#fff8e1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;margin:24px 0;">
                <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📞 Contact Us</h3>
                <p style="margin:4px 0;font-size:14px;color:#333;"><strong>Location:</strong> Turtle Crossing, The Strand Subdivision, Morong, Bataan</p>
                <p style="margin:4px 0;font-size:14px;color:#333;"><strong>Email:</strong> reservations@adrianovillas.com</p>
              </div>

              <p style="color:#333;line-height:1.7;">
                For urgent concerns, don't hesitate to reach out directly. We're always happy to help! 🙏
              </p>
            </div>

            <div style="background:#f5f5f5;padding:16px 28px;border-top:1px solid #e0e0e0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#555;">Warm regards, <strong>The Adriano Villas &amp; Resort Team 🏝️</strong></p>
              <p style="margin:8px 0 0;font-size:11px;color:#999;">
                This is an automated confirmation email. Please do not reply to this message.<br>
                If you have already settled your reservation, kindly disregard this email.
              </p>
            </div>

          </div>
        `,
      });
    } catch (emailErr) {
      console.error('⚠️ Email sending failed:', emailErr?.response?.data || emailErr.message);
    }

    // ✉️ Notify admin of new booking
    try {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const checkInFmt  = start ? start.toDateString() : 'Not specified';
        const checkOutFmt = end   ? end.toDateString()   : 'Not specified';
        await sendEmail({
          toEmail: adminEmail,
          toName: 'Admin',
          subject: `🏝️ New Booking Inquiry — ${firstName} ${lastName}`,
          htmlContent: `
            <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #d6c9a0;border-radius:12px;overflow:hidden;">
              <div style="background:#0d1b2a;padding:24px;text-align:center;">
                <h1 style="color:#c9a96e;margin:0;font-size:20px;letter-spacing:2px;">ADRIANO VILLAS</h1>
                <p style="color:#8a9bb0;margin:4px 0 0;font-size:11px;letter-spacing:3px;text-transform:uppercase;">New Booking Inquiry</p>
              </div>
              <div style="padding:28px;background:#fff;">
                <h2 style="color:#0d1b2a;margin-top:0;">New inquiry received! 📋</h2>
                <div style="background:#f8f6f1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;">
                  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
                    <tr><td style="padding:5px 0;font-weight:bold;width:130px;">Name</td><td>${firstName} ${lastName}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Email</td><td>${email}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Phone</td><td>${phone || 'Not provided'}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Unit</td><td>${roomType || 'Not selected'}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Check-in</td><td>${checkInFmt}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Check-out</td><td>${checkOutFmt}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Guests</td><td>${guests || 1}</td></tr>
                    ${message ? `<tr><td style="padding:5px 0;font-weight:bold;vertical-align:top;">Message</td><td>${message}</td></tr>` : ''}
                  </table>
                </div>
                <p style="margin-top:20px;font-size:14px;color:#555;">
                  Log in to your <a href="${process.env.SITE_URL || '#'}/admin" style="color:#c9a96e;">admin panel</a> to approve or reject this booking.
                </p>
              </div>
            </div>
          `,
        });
      }
    } catch (adminEmailErr) {
      console.error('⚠️ Admin notification email failed:', adminEmailErr?.response?.data || adminEmailErr.message);
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bookings/availability ───────────────────────────────────────────
// Returns approved bookings (per unit) + globally blocked dates for the calendar
router.get('/availability', async (req, res) => {
  try {
    const approvedBookings = await Booking.find(
      { status: 'approved' },
      'checkIn checkOut roomType firstName lastName _id'
    );
    const blockedDates = await BlockedDate.find({}, 'date reason');
    res.json({ bookings: approvedBookings, blocked: blockedDates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bookings/message — save a contact/inquiry message ──────────────
router.post('/message', async (req, res) => {
  try {
    const { name, contact, message } = req.body;
    if (!name || !contact || !message) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    const msg = new Message({ name, contact, message });
    await msg.save();

    // 🔔 Notify admin
    try {
      const adminToken = process.env.ADMIN_DEVICE_TOKEN;
      if (adminToken && global.firebaseAdmin) {
        await global.firebaseAdmin.messaging().send({
          token: adminToken,
          notification: {
            title: '💬 New Message!',
            body: `${name}: "${message.substring(0, 60)}..."`,
          },
          android: { priority: 'high', notification: { sound: 'default' } }
        });
      }
    } catch (notifErr) {
      console.error('⚠️ Message notification failed:', notifErr.message);
    }

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
