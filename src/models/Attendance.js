const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    checkIn: Date,
    checkOut: Date,
    status: {
      type: String,
      enum: ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend'],
      default: 'absent',
    },
    lateMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    workHours: { type: Number, default: 0 },
    notes: String,
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // for manual entries
    location: {
      checkInLat: Number,
      checkInLng: Number,
      checkOutLat: Number,
      checkOutLng: Number,
    },
  },
  { timestamps: true }
);

// Unique attendance per employee per date
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

// Auto-calculate work hours on save
attendanceSchema.pre('save', function (next) {
  if (this.checkIn && this.checkOut) {
    const diff = (this.checkOut - this.checkIn) / (1000 * 60 * 60);
    this.workHours = Math.round(diff * 100) / 100;
    if (diff > 8) {
      this.overtimeMinutes = Math.round((diff - 8) * 60);
    }
  }
  next();
});

module.exports = mongoose.model('Attendance', attendanceSchema);
