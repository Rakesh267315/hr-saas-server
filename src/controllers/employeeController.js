const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const fmtEmp = (e) => {
  if (!e) return null;
  return {
    _id: e.id, id: e.id,
    employeeCode: e.employee_code,
    userId: e.user_id,
    firstName: e.first_name, lastName: e.last_name,
    fullName: `${e.first_name} ${e.last_name || ''}`.trim(),
    email: e.email, phone: e.phone,
    dateOfBirth: e.date_of_birth, gender: e.gender, address: e.address,
    department: e.department_id
      ? { _id: e.department_id, id: e.department_id, name: e.department_name, code: e.department_code }
      : null,
    designation: e.designation, employmentType: e.employment_type,
    joiningDate: e.joining_date, exitDate: e.exit_date, status: e.status,
    baseSalary: parseFloat(e.base_salary) || 0,
    hourlyRate: parseFloat(e.hourly_rate) || 0,
    bankAccount: { name: e.bank_account_name, accountNumber: e.bank_account_number, ifsc: e.bank_ifsc },
    workStartTime: e.work_start_time, workEndTime: e.work_end_time,
    workingDaysPerWeek: e.working_days_per_week,
    leaveBalance: {
      annual: e.leave_annual, sick: e.leave_sick,
      casual: e.leave_casual, maternity: e.leave_maternity, unpaid: e.leave_unpaid,
    },
    avatar: e.avatar,
    reportingManager: e.reporting_manager_id
      ? { _id: e.reporting_manager_id, firstName: e.rm_first_name, lastName: e.rm_last_name }
      : null,
    createdAt: e.created_at, updatedAt: e.updated_at,
  };
};

const empSelect = `
  e.*,
  d.name AS department_name, d.code AS department_code,
  rm.first_name AS rm_first_name, rm.last_name AS rm_last_name
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
`;

exports.getAll = async (req, res) => {
  try {
    const { department, status, search, page = 1, limit = 20 } = req.query;
    const conditions = []; const params = [];
    if (department) { params.push(department); conditions.push(`e.department_id=$${params.length}`); }
    if (status) { params.push(status); conditions.push(`e.status=$${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length} OR e.email ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [rows, countRow] = await Promise.all([
      pool.query(`SELECT ${empSelect} ${where} ORDER BY e.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM employees e ${where}`, params),
    ]);
    const total = parseInt(countRow.rows[0].count);
    res.json({ success: true, data: rows.rows.map(fmtEmp), pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${empSelect} WHERE e.id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: fmtEmp(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.create = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      firstName, lastName, email, phone, dateOfBirth, gender, address,
      department, designation, employmentType, joiningDate,
      baseSalary, hourlyRate, workStartTime, workEndTime, reportingManager,
      bankAccount, createAccount, password, role,
    } = req.body;

    // Auto-generate employee code
    const codeRes = await client.query(`SELECT COUNT(*) FROM employees`);
    const code = `EMP${String(parseInt(codeRes.rows[0].count) + 1).padStart(4, '0')}`;

    const empRes = await client.query(
      `INSERT INTO employees (employee_code,first_name,last_name,email,phone,date_of_birth,gender,address,
        department_id,designation,employment_type,joining_date,base_salary,hourly_rate,
        work_start_time,work_end_time,reporting_manager_id,
        bank_account_name,bank_account_number,bank_ifsc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [code, firstName, lastName||null, email, phone, dateOfBirth||null, gender, address,
       department||null, designation, employmentType||'full_time', joiningDate||null,
       baseSalary||0, hourlyRate||0, workStartTime||'09:00', workEndTime||'18:00',
       reportingManager||null, bankAccount?.name||null, bankAccount?.accountNumber||null, bankAccount?.ifsc||null]
    );
    const emp = empRes.rows[0];

    if (department) await client.query(`UPDATE departments SET head_count=head_count+1 WHERE id=$1`, [department]);

    if (createAccount) {
      const hashed = await bcrypt.hash(password || 'Hr@123456', 12);
      const userRes = await client.query(
        `INSERT INTO users (name,email,password,role,employee_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [`${firstName} ${lastName}`, email, hashed, role||'employee', emp.id]
      );
      await client.query(`UPDATE employees SET user_id=$1 WHERE id=$2`, [userRes.rows[0].id, emp.id]);
    }

    await client.query('COMMIT');
    const full = await pool.query(`SELECT ${empSelect} WHERE e.id=$1`, [emp.id]);
    res.status(201).json({ success: true, data: fmtEmp(full.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Employee with this email already exists' });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

exports.update = async (req, res) => {
  try {
    const fields = [];
    const vals = [];
    const map = {
      firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
      dateOfBirth: 'date_of_birth', gender: 'gender', address: 'address',
      department: 'department_id', designation: 'designation', employmentType: 'employment_type',
      joiningDate: 'joining_date', exitDate: 'exit_date', status: 'status',
      baseSalary: 'base_salary', hourlyRate: 'hourly_rate',
      workStartTime: 'work_start_time', workEndTime: 'work_end_time',
      reportingManager: 'reporting_manager_id', avatar: 'avatar',
    };
    for (const [key, col] of Object.entries(map)) {
      if (req.body[key] !== undefined) { vals.push(req.body[key]); fields.push(`${col}=$${vals.length}`); }
    }
    if (!fields.length) return res.status(400).json({ success: false, message: 'No fields to update' });
    vals.push(new Date()); fields.push(`updated_at=$${vals.length}`);
    vals.push(req.params.id);
    await pool.query(`UPDATE employees SET ${fields.join(',')} WHERE id=$${vals.length}`, vals);
    const full = await pool.query(`SELECT ${empSelect} WHERE e.id=$1`, [req.params.id]);
    if (!full.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: fmtEmp(full.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE employees SET status='terminated',exit_date=NOW() WHERE id=$1 RETURNING department_id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (r.rows[0].department_id)
      await pool.query(`UPDATE departments SET head_count=GREATEST(head_count-1,0) WHERE id=$1`, [r.rows[0].department_id]);
    res.json({ success: true, message: 'Employee terminated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateCredentials = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password } = req.body;
    if (!email && !password)
      return res.status(400).json({ success: false, message: 'Provide at least email or password to update' });

    const empRes = await pool.query('SELECT id, user_id, email FROM employees WHERE id=$1', [req.params.id]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    const emp = empRes.rows[0];
    if (!emp.user_id)
      return res.status(400).json({ success: false, message: 'This employee has no login account. Create one first.' });

    await client.query('BEGIN');
    if (email) {
      await client.query('UPDATE users SET email=$1, updated_at=NOW() WHERE id=$2', [email, emp.user_id]);
      await client.query('UPDATE employees SET email=$1, updated_at=NOW() WHERE id=$2', [email, emp.id]);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 12);
      await client.query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashed, emp.user_id]);
    }
    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Credentials updated successfully',
      changedBy: req.user?.name || 'Admin',
      changedAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505')
      return res.status(409).json({ success: false, message: 'This email is already used by another account' });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

exports.getStats = async (req, res) => {
  try {
    const [total, active, onLeave, byDept] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM employees'),
      pool.query(`SELECT COUNT(*) FROM employees WHERE status='active'`),
      pool.query(`SELECT COUNT(*) FROM employees WHERE status='on_leave'`),
      pool.query(`SELECT d.name, COUNT(e.id) AS count FROM employees e JOIN departments d ON d.id=e.department_id GROUP BY d.name`),
    ]);
    res.json({ success: true, data: {
      total: parseInt(total.rows[0].count),
      active: parseInt(active.rows[0].count),
      onLeave: parseInt(onLeave.rows[0].count),
      byDepartment: byDept.rows.map((r) => ({ name: r.name, count: parseInt(r.count) })),
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
