const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  refNumber:  { type: String, unique: true },
  firstName:  { type: String, required: true },
  lastName:   { type: String, required: true },
  email:      { type: String, required: true },
  phone:      { type: String },
  checkIn:    { type: Date, required: true },
  checkOut:   { type: Date, required: true },
  roomType:   {
    type: String,
    required: true,
    enum: [
      'Ocean View Villa',
      'Mountain View Villa',
      'Cabana 1',
      'Cabana 2',
      'Cabana 3',
      'The Cabin',
      'Not selected'
    ]
  },
  guests:     { type: Number, default: 1 },
  message:    { type: String },
  status:     { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
  adminNotes: { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema);
