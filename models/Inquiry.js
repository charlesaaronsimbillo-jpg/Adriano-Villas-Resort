const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  firstName:  { type: String, required: true },
  lastName:   { type: String, default: '' },
  email:      { type: String, required: true },
  phone:      { type: String, default: '' },
  checkIn:    { type: Date },
  checkOut:   { type: Date },
  unit:       { type: String, default: 'Not selected' },
  guests:     { type: Number, default: 1 },
  message:    { type: String, default: '' },
  status:     { type: String, default: 'new', enum: ['new', 'closed'] },
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('Inquiry', inquirySchema);
