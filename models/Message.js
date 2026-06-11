const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  contact:   { type: String, required: true },
  message:   { type: String, required: true },
  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
