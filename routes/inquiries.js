const express = require('express');
const router = express.Router();
const Inquiry = require('../models/Inquiry');
const axios = require('axios');

// ── EMAIL HELPER ──────────────────────────────────────────────────────────────
async function sendEmail({ toEmail, toName, subject, htmlContent }) {
  await axios.post(
    'https://api.resend.com/emails',
    {
      from: `${process.env.SENDER_NAME || 'Adriano Villas & Resort'} <${process.env.SENDER_EMAIL || 'onboarding@resend.dev'}>`,
      to: [`${toName} <${toEmail}>`],
      subject,
      html: htmlContent,
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// ── POST /api/inquiries ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, checkIn, checkOut, unit, guests, message } = req.body;

    if (!firstName || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const inquiry = new Inquiry({
      firstName,
      lastName: lastName || '',
      email,
      phone: phone || '',
      checkIn:  checkIn  ? new Date(checkIn)  : undefined,
      checkOut: checkOut ? new Date(checkOut) : undefined,
      unit:    unit || 'Not selected',
      guests:  guests || 1,
      message: message || ''
    });
    await inquiry.save();

    // ✅ Respond immediately
    res.status(201).json({ success: true, inquiry });

    // ✉️ Confirmation email to guest (background)
    try {
      await sendEmail({
        toEmail: email,
        toName: `${firstName} ${lastName || ''}`.trim(),
        subject: 'We received your inquiry – Adriano Villas & Resort 🏝️',
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #d6c9a0;border-radius:12px;overflow:hidden;">
            <div style="background:#0d1b2a;padding:28px 24px;text-align:center;">
              <h1 style="color:#c9a96e;margin:0;font-size:22px;letter-spacing:2px;">ADRIANO VILLAS</h1>
              <p style="color:#8a9bb0;margin:6px 0 0;font-size:12px;letter-spacing:3px;text-transform:uppercase;">&amp; Resort · Morong, Bataan</p>
            </div>
            <div style="padding:28px;background:#fff;">
              <h2 style="color:#0d1b2a;margin-top:0;">Hi ${firstName}! 👋</h2>
              <p style="color:#333;line-height:1.7;">
                We received your inquiry and we'll get back to you as soon as possible! 😊
              </p>
              <div style="background:#f8f6f1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;margin:24px 0;">
                <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📋 Your Inquiry</h3>
                <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
                  <tr><td style="padding:5px 0;font-weight:bold;width:130px;">Name</td><td>${firstName} ${lastName||''}</td></tr>
                  ${unit&&unit!=='Not selected'?`<tr><td style="padding:5px 0;font-weight:bold;">Unit</td><td>${unit}</td></tr>`:''}
                  ${checkIn?`<tr><td style="padding:5px 0;font-weight:bold;">Check-in</td><td>${new Date(checkIn).toDateString()}</td></tr>`:''}
                  ${checkOut?`<tr><td style="padding:5px 0;font-weight:bold;">Check-out</td><td>${new Date(checkOut).toDateString()}</td></tr>`:''}
                  ${message?`<tr><td style="padding:5px 0;font-weight:bold;vertical-align:top;">Message</td><td>${message}</td></tr>`:''}
                </table>
              </div>
              <div style="background:#fff8e1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;">
                <h3 style="margin-top:0;color:#0d1b2a;font-size:15px;">📞 Reach Us</h3>
                <p style="margin:4px 0;font-size:14px;color:#333;"><strong>Facebook:</strong> <a href="https://www.facebook.com/adrianovillasandresort" style="color:#1877f2;">Adriano Villas &amp; Resort</a></p>
                <p style="margin:4px 0;font-size:14px;color:#333;"><strong>Location:</strong> Turtle Crossing, The Strand Subdivision, Morong, Bataan</p>
              </div>
            </div>
            <div style="background:#f5f5f5;padding:16px 28px;border-top:1px solid #e0e0e0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#555;">Warm regards, <strong>The Adriano Villas &amp; Resort Team 🏝️</strong></p>
              <p style="margin:8px 0 0;font-size:11px;color:#999;">This is an automated email. Please do not reply directly.</p>
            </div>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('⚠️ Inquiry guest email failed:', emailErr?.response?.data || emailErr.message);
    }

    // ✉️ Notify admin (background)
    try {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        await sendEmail({
          toEmail: adminEmail,
          toName: 'Admin',
          subject: `💬 New Inquiry — ${firstName} ${lastName || ''}`,
          htmlContent: `
            <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #d6c9a0;border-radius:12px;overflow:hidden;">
              <div style="background:#0d1b2a;padding:24px;text-align:center;">
                <h1 style="color:#c9a96e;margin:0;font-size:20px;letter-spacing:2px;">ADRIANO VILLAS</h1>
                <p style="color:#8a9bb0;margin:4px 0 0;font-size:11px;letter-spacing:3px;text-transform:uppercase;">New Inquiry Received</p>
              </div>
              <div style="padding:28px;background:#fff;">
                <h2 style="color:#0d1b2a;margin-top:0;">New inquiry! 💬</h2>
                <div style="background:#f8f6f1;border-left:4px solid #c9a96e;padding:18px 20px;border-radius:8px;">
                  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
                    <tr><td style="padding:5px 0;font-weight:bold;width:130px;">Name</td><td>${firstName} ${lastName||''}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Email</td><td>${email}</td></tr>
                    <tr><td style="padding:5px 0;font-weight:bold;">Phone</td><td>${phone||'Not provided'}</td></tr>
                    ${unit&&unit!=='Not selected'?`<tr><td style="padding:5px 0;font-weight:bold;">Unit</td><td>${unit}</td></tr>`:''}
                    ${checkIn?`<tr><td style="padding:5px 0;font-weight:bold;">Check-in</td><td>${new Date(checkIn).toDateString()}</td></tr>`:''}
                    ${checkOut?`<tr><td style="padding:5px 0;font-weight:bold;">Check-out</td><td>${new Date(checkOut).toDateString()}</td></tr>`:''}
                    ${message?`<tr><td style="padding:5px 0;font-weight:bold;vertical-align:top;">Message</td><td>${message}</td></tr>`:''}
                  </table>
                </div>
                <p style="margin-top:20px;font-size:14px;color:#555;">
                  View in your <a href="${process.env.SITE_URL||'#'}/admin" style="color:#c9a96e;">admin panel</a>.
                </p>
              </div>
            </div>
          `
        });
      }
    } catch (adminEmailErr) {
      console.error('⚠️ Admin inquiry email failed:', adminEmailErr?.response?.data || adminEmailErr.message);
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/inquiries — admin only ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const inquiries = await Inquiry.find(filter).sort({ createdAt: -1 });
    res.json(inquiries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/inquiries/:id — close ─────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status || 'closed' },
      { new: true }
    );
    res.json(inquiry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/inquiries/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await Inquiry.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
