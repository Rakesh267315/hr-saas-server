const Employee = require('../models/Employee');
const User = require('../models/User');
const Department = require('../models/Department');
const bcrypt = require('bcryptjs');

exports.getAll = async (req, res) => {
  try {
    const { department, status, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (department) filter.department = department;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { firstName: new RegExp(search, 'i') },
        { lastName: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { employeeCode: new RegExp(search, 'i') },
      ];
    }

    const skip = (page - 1) * limit;
    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .populate('department', 'name code')
        .populate('reportingManager', 'firstName lastName')
        .skip(skip)
        .limit(+limit)
        .sort({ createdAt: -1 }),
      Employee.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: employees,
      pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('department', 'name code')
      .populate('reportingManager', 'firstName lastName designation');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone, dateOfBirth, gender,
      department, designation, employmentType, joiningDate,
      baseSalary, hourlyRate, workStartTime, workEndTime,
      reportingManager, address, bankAccount,
      // User account
      createAccount, password, role,
    } = req.body;

    const employee = await Employee.create({
      firstName, lastName, email, phone, dateOfBirth, gender,
      department, designation, employmentType, joiningDate,
      baseSalary, hourlyRate, workStartTime, workEndTime,
      reportingManager, address, bankAccount,
    });

    // Update department headcount
    await Department.findByIdAndUpdate(department, { $inc: { headCount: 1 } });

    // Optionally create a user account
    if (createAccount) {
      const user = await User.create({
        name: `${firstName} ${lastName}`,
        email,
        password: password || 'Hr@123456',
        role: role || 'employee',
        employeeId: employee._id,
      });
      employee.userId = user._id;
      await employee.save();
    }

    res.status(201).json({ success: true, data: employee });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: 'Employee with this email already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate('department', 'name code');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { status: 'terminated', exitDate: new Date() },
      { new: true }
    );
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    await Department.findByIdAndUpdate(employee.department, { $inc: { headCount: -1 } });
    res.json({ success: true, message: 'Employee terminated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const [total, active, onLeave, byDept] = await Promise.all([
      Employee.countDocuments(),
      Employee.countDocuments({ status: 'active' }),
      Employee.countDocuments({ status: 'on_leave' }),
      Employee.aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
        { $unwind: '$dept' },
        { $project: { name: '$dept.name', count: 1 } },
      ]),
    ]);
    res.json({ success: true, data: { total, active, onLeave, byDepartment: byDept } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
