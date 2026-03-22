const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { startOfDay, endOfDay, startOfMonth, endOfMonth, format } = require('date-fns');

exports.checkIn = async (req, res) => {
  try {
    const { employeeId, notes, lat, lng } = req.body;
    const today = new Date();
    const dateOnly = startOfDay(today);

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const existing = await Attendance.findOne({ employee: employeeId, date: dateOnly });
    if (existing?.checkIn)
      return res.status(409).json({ success: false, message: 'Already checked in today' });

    // Calculate late minutes
    const [h, m] = employee.workStartTime.split(':').map(Number);
    const scheduled = new Date(today);
    scheduled.setHours(h, m, 0, 0);
    const lateMinutes = Math.max(0, Math.round((today - scheduled) / 60000));
    const status = lateMinutes > 15 ? 'late' : 'present';

    const attendance = await Attendance.findOneAndUpdate(
      { employee: employeeId, date: dateOnly },
      {
        employee: employeeId,
        date: dateOnly,
        checkIn: today,
        status,
        lateMinutes,
        notes,
        'location.checkInLat': lat,
        'location.checkInLng': lng,
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const { employeeId, lat, lng } = req.body;
    const today = startOfDay(new Date());

    const attendance = await Attendance.findOne({ employee: employeeId, date: today });
    if (!attendance || !attendance.checkIn)
      return res.status(400).json({ success: false, message: 'No check-in found for today' });
    if (attendance.checkOut)
      return res.status(409).json({ success: false, message: 'Already checked out' });

    attendance.checkOut = new Date();
    attendance['location.checkOutLat'] = lat;
    attendance['location.checkOutLng'] = lng;
    await attendance.save();

    res.json({ success: true, data: attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getByEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59);

    const records = await Attendance.find({
      employee: id,
      date: { $gte: start, $lte: end },
    }).sort({ date: 1 });

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59);

    const records = await Attendance.find({ employee: id, date: { $gte: start, $lte: end } });

    const summary = {
      present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0,
      totalWorkHours: 0, totalOvertimeHours: 0, totalLateMinutes: 0,
    };
    records.forEach((r) => {
      if (r.status === 'present' || r.status === 'late') summary.present++;
      if (r.status === 'absent') summary.absent++;
      if (r.status === 'late') summary.late++;
      if (r.status === 'half_day') summary.halfDay++;
      if (r.status === 'on_leave') summary.onLeave++;
      summary.totalWorkHours += r.workHours || 0;
      summary.totalOvertimeHours += (r.overtimeMinutes || 0) / 60;
      summary.totalLateMinutes += r.lateMinutes || 0;
    });

    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markAbsent = async (req, res) => {
  try {
    const { date } = req.body;
    const targetDate = startOfDay(new Date(date));

    // Find all active employees who haven't checked in
    const employees = await Employee.find({ status: 'active' });
    const present = await Attendance.distinct('employee', {
      date: targetDate,
      status: { $in: ['present', 'late', 'on_leave', 'half_day'] },
    });

    const presentSet = new Set(present.map(String));
    const absentees = employees.filter((e) => !presentSet.has(String(e._id)));

    const ops = absentees.map((e) => ({
      updateOne: {
        filter: { employee: e._id, date: targetDate },
        update: { employee: e._id, date: targetDate, status: 'absent' },
        upsert: true,
      },
    }));

    if (ops.length) await Attendance.bulkWrite(ops);
    res.json({ success: true, message: `Marked ${ops.length} employees absent` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getToday = async (req, res) => {
  try {
    const today = startOfDay(new Date());
    const records = await Attendance.find({ date: today })
      .populate('employee', 'firstName lastName employeeCode department designation')
      .sort({ checkIn: -1 });

    const stats = {
      present: records.filter((r) => ['present', 'late'].includes(r.status)).length,
      absent: records.filter((r) => r.status === 'absent').length,
      late: records.filter((r) => r.status === 'late').length,
      onLeave: records.filter((r) => r.status === 'on_leave').length,
    };

    res.json({ success: true, data: records, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
