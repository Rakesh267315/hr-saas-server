const Break = require('../models/Break');
const Employee = require('../models/Employee');
const { startOfDay } = require('date-fns');

exports.startBreak = async (req, res) => {
  try {
    const { employeeId } = req.body;
    const today = startOfDay(new Date());

    // Only one active break at a time
    const active = await Break.findOne({ employee: employeeId, date: today, endTime: null });
    if (active) return res.status(409).json({ success: false, message: 'Break already in progress' });

    const record = await Break.create({
      employee: employeeId,
      user: req.user._id,
      date: today,
      startTime: new Date(),
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.endBreak = async (req, res) => {
  try {
    const { employeeId } = req.body;
    const today = startOfDay(new Date());

    const record = await Break.findOne({ employee: employeeId, date: today, endTime: null });
    if (!record) return res.status(404).json({ success: false, message: 'No active break found' });

    record.endTime = new Date();
    await record.save();

    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get today's break summary per employee (admin dashboard)
exports.getToday = async (req, res) => {
  try {
    const today = startOfDay(new Date());

    const breaks = await Break.find({ date: today })
      .populate('employee', 'firstName lastName employeeCode designation department')
      .sort({ startTime: -1 });

    // Aggregate per employee: total minutes + active status
    const map = new Map();
    for (const b of breaks) {
      const empId = String(b.employee?._id);
      if (!map.has(empId)) {
        map.set(empId, {
          employee: b.employee,
          totalMinutes: 0,
          isOnBreak: false,
          breakCount: 0,
          currentBreakStart: null,
        });
      }
      const entry = map.get(empId);
      entry.breakCount++;
      if (!b.endTime) {
        entry.isOnBreak = true;
        entry.currentBreakStart = b.startTime;
        // Count elapsed so far
        entry.totalMinutes += Math.round((new Date() - b.startTime) / 60000);
      } else {
        entry.totalMinutes += b.durationMinutes;
      }
    }

    res.json({
      success: true,
      data: Array.from(map.values()),
      onBreakCount: Array.from(map.values()).filter((e) => e.isOnBreak).length,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get break history for a specific employee
exports.getByEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const today = startOfDay(new Date());
    const records = await Break.find({ employee: id, date: today }).sort({ startTime: 1 });
    const totalMinutes = records.reduce((sum, b) => {
      if (b.endTime) return sum + b.durationMinutes;
      return sum + Math.round((new Date() - b.startTime) / 60000);
    }, 0);
    res.json({ success: true, data: records, totalMinutes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
