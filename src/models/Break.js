const mongoose = require('mongoose');

const breakSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    durationMinutes: { type: Number, default: 0 }, // auto-calculated on end
  },
  { timestamps: true }
);

// Auto-calculate duration when endTime is set
breakSchema.pre('save', function (next) {
  if (this.startTime && this.endTime) {
    this.durationMinutes = Math.round((this.endTime - this.startTime) / 60000);
  }
  next();
});

module.exports = mongoose.model('Break', breakSchema);
