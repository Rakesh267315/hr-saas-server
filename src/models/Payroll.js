const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    month: { type: Number, required: true }, // 1-12
    year: { type: Number, required: true },
    period: { type: String }, // "2024-01"
    // Earnings
    baseSalary: { type: Number, default: 0 },
    overtimePay: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    allowances: {
      hra: { type: Number, default: 0 },
      transport: { type: Number, default: 0 },
      medical: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    grossSalary: { type: Number, default: 0 },
    // Deductions
    deductions: {
      tax: { type: Number, default: 0 },
      providentFund: { type: Number, default: 0 },
      insurance: { type: Number, default: 0 },
      lateDeduction: { type: Number, default: 0 },
      loanRepayment: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    totalDeductions: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    // Attendance summary
    workingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    leaveDays: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    // Status
    status: {
      type: String,
      enum: ['draft', 'approved', 'paid', 'cancelled'],
      default: 'draft',
    },
    paymentDate: Date,
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'cash', 'cheque'],
      default: 'bank_transfer',
    },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: String,
  },
  { timestamps: true }
);

payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

payrollSchema.pre('save', function (next) {
  this.period = `${this.year}-${String(this.month).padStart(2, '0')}`;
  const allowanceTotal =
    (this.allowances?.hra || 0) +
    (this.allowances?.transport || 0) +
    (this.allowances?.medical || 0) +
    (this.allowances?.other || 0);
  this.grossSalary = this.baseSalary + this.overtimePay + this.bonus + allowanceTotal;
  this.totalDeductions =
    (this.deductions?.tax || 0) +
    (this.deductions?.providentFund || 0) +
    (this.deductions?.insurance || 0) +
    (this.deductions?.lateDeduction || 0) +
    (this.deductions?.loanRepayment || 0) +
    (this.deductions?.other || 0);
  this.netSalary = this.grossSalary - this.totalDeductions;
  next();
});

module.exports = mongoose.model('Payroll', payrollSchema);
