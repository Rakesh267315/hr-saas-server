const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: String,
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other'] },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zip: String,
    },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    designation: { type: String, required: true },
    employmentType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract', 'intern'],
      default: 'full_time',
    },
    joiningDate: { type: Date, required: true },
    exitDate: Date,
    status: {
      type: String,
      enum: ['active', 'on_leave', 'resigned', 'terminated'],
      default: 'active',
    },
    // Salary
    baseSalary: { type: Number, required: true, default: 0 },
    hourlyRate: { type: Number, default: 0 },
    bankAccount: {
      bankName: String,
      accountNumber: String,
      ifsc: String,
    },
    // Work schedule
    workStartTime: { type: String, default: '09:00' },
    workEndTime: { type: String, default: '18:00' },
    workingDaysPerWeek: { type: Number, default: 5 },
    // Leave balances
    leaveBalance: {
      annual: { type: Number, default: 15 },
      sick: { type: Number, default: 10 },
      casual: { type: Number, default: 7 },
      maternity: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
    },
    avatar: String,
    documents: [
      {
        name: String,
        url: String,
        type: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Auto-generate employee code
employeeSchema.pre('validate', async function (next) {
  if (!this.employeeCode) {
    const count = await mongoose.model('Employee').countDocuments();
    this.employeeCode = `EMP${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Employee', employeeSchema);
