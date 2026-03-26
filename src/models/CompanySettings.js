const mongoose = require('mongoose');

const companySettingsSchema = new mongoose.Schema(
  {
    companyId: { type: String, default: 'default', unique: true },
    companyName: { type: String, default: 'My Company' },
    officeStartTime: { type: String, default: '10:00' }, // HH:mm
    officeEndTime: { type: String, default: '19:00' },   // HH:mm
    weeklyOffDay: {
      type: String,
      enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      default: 'Sunday',
    },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanySettings', companySettingsSchema);
