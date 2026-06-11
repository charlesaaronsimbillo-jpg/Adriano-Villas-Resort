const mongoose = require('mongoose');

const blockedDateSchema = new mongoose.Schema({
  date:    { type: Date, required: true, unique: true },
  reason:  { type: String, default: 'Unavailable' },
  addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BlockedDate', blockedDateSchema);
