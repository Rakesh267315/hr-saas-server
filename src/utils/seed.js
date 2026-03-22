require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const User = require('../models/User');
const Department = require('../models/Department');
const Employee = require('../models/Employee');

const seed = async () => {
  await connectDB();

  // Clear
  await Promise.all([User.deleteMany(), Department.deleteMany(), Employee.deleteMany()]);

  // Departments
  const [eng, hr, sales] = await Department.insertMany([
    { name: 'Engineering', code: 'ENG', description: 'Software Development' },
    { name: 'Human Resources', code: 'HR', description: 'HR & People Ops' },
    { name: 'Sales', code: 'SALES', description: 'Revenue & Growth' },
  ]);

  // Admin user
  const admin = await User.create({
    name: 'Super Admin',
    email: 'admin@hr.com',
    password: 'Admin@123',
    role: 'super_admin',
  });

  // Sample employees
  const emp1 = await Employee.create({
    firstName: 'Rahul', lastName: 'Sharma',
    email: 'rahul@hr.com', phone: '9876543210',
    department: eng._id, designation: 'Senior Developer',
    joiningDate: new Date('2022-01-15'),
    baseSalary: 80000, hourlyRate: 500,
    workStartTime: '09:00', workEndTime: '18:00',
  });

  const emp2 = await Employee.create({
    firstName: 'Priya', lastName: 'Patel',
    email: 'priya@hr.com', phone: '9876543211',
    department: hr._id, designation: 'HR Manager',
    joiningDate: new Date('2021-06-01'),
    baseSalary: 60000, hourlyRate: 375,
    workStartTime: '09:30', workEndTime: '18:30',
  });

  // Create user accounts for employees
  await User.create({
    name: 'Rahul Sharma', email: 'rahul@hr.com',
    password: 'Hr@123456', role: 'employee', employeeId: emp1._id,
  });
  await User.create({
    name: 'Priya Patel', email: 'priya@hr.com',
    password: 'Hr@123456', role: 'hr', employeeId: emp2._id,
  });

  console.log('Seeded successfully!');
  console.log('Admin: admin@hr.com / Admin@123');
  console.log('Employee: rahul@hr.com / Hr@123456');
  process.exit(0);
};

seed().catch((err) => { console.error(err); process.exit(1); });
