const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { eachDayOfInterval, isWeekend, format } = require('date-fns');

const countWorkdays = (start, end) =>
  eachDayOfInterval({ start, end }).filter((d) => !isWeekend(d)).length;

exports.apply = async (req, res) => {
  try {
    const { employeeId, leaveType, startDate, endDate, reason, isHalfDay, halfDayPeriod } = req.body;

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = isHalfDay ? 0.5 : countWorkdays(start, end);

    // Check leave balance
    const balance = employee.leaveBalance[leaveType];
    if (balance !== undefined && balance < totalDays)
      return res.status(400).json({ success: false, message: `Insufficient ${leaveType} leave balance` });

    const leave = await Leave.create({
      employee: employeeId,
      leaveType, startDate: start, endDate: end, totalDays, reason,
      isHalfDay, halfDayPeriod,
    });

    res.status(201).json({ success: true, data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { status, employeeId, month, year, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (employeeId) filter.employee = employeeId;
    if (month && year) {
      filter.startDate = {
        $gte: new Date(year, month - 1, 1),
        $lte: new Date(year, month, 0),
      };
    }

    const skip = (page - 1) * limit;
    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate('employee', 'firstName lastName employeeCode department')
        .populate('approvedBy', 'name')
        .skip(skip)
        .limit(+limit)
        .sort({ createdAt: -1 }),
      Leave.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: leaves,
      pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeCode leaveBalance')
      .populate('approvedBy', 'name');
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });
    res.json({ success: true, data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const leave = await Leave.findById(req.params.id).populate('employee');
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    if (leave.status !== 'pending')
      return res.status(400).json({ success: false, message: 'Only pending leaves can be updated' });

    leave.status = status;
    leave.approvedBy = req.user._id;
    leave.approvedAt = new Date();
    if (rejectionReason) leave.rejectionReason = rejectionReason;

    if (status === 'approved') {
      // Deduct from balance
      const emp = await Employee.findById(leave.employee._id);
      if (emp.leaveBalance[leave.leaveType] !== undefined) {
        emp.leaveBalance[leave.leaveType] -= leave.totalDays;
        emp.status = 'on_leave';
        await emp.save();
      }
      // Mark attendance as on_leave
      const days = eachDayOfInterval({ start: leave.startDate, end: leave.endDate }).filter(
        (d) => !isWeekend(d)
      );
      await Promise.all(
        days.map((day) =>
          Attendance.findOneAndUpdate(
            { employee: leave.employee._id, date: day },
            { employee: leave.employee._id, date: day, status: 'on_leave' },
            { upsert: true }
          )
        )
      );
    }

    await leave.save();
    res.json({ success: true, data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.cancel = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });
    if (!['pending', 'approved'].includes(leave.status))
      return res.status(400).json({ success: false, message: 'Cannot cancel this leave' });

    if (leave.status === 'approved') {
      // Restore balance
      const emp = await Employee.findById(leave.employee);
      emp.leaveBalance[leave.leaveType] += leave.totalDays;
      await emp.save();
    }
    leave.status = 'cancelled';
    await leave.save();
    res.json({ success: true, message: 'Leave cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getBalance = async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id).select('leaveBalance firstName lastName');
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: emp.leaveBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
