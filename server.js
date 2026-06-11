require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'adriano-secret-2026',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI || 'mongodb://localhost:27017/adriano_villas',
    collectionName: 'sessions'
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// Static files (public folder — index.html, admin.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/adriano_villas')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Firebase Admin (optional — for push notifications)
if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  try {
    const admin = require('firebase-admin');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      })
    });
    global.firebaseAdmin = admin;
    console.log('✅ Firebase Admin initialized');
  } catch (e) {
    console.warn('⚠️ Firebase Admin failed to initialize:', e.message);
  }
}

// Routes
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/inquiries', require('./routes/inquiries'));

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏝️ Adriano Villas server running on http://localhost:${PORT}`));
