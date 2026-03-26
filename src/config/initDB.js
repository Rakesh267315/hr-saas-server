const pool = require('./db');

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'employee' CHECK (role IN ('super_admin','admin','hr','employee')),
      is_active BOOLEAN DEFAULT true,
      employee_id UUID,
      last_login TIMESTAMPTZ,
      avatar TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS departments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) UNIQUE NOT NULL,
      code VARCHAR(50),
      description TEXT,
      manager_id UUID,
      is_active BOOLEAN DEFAULT true,
      head_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS employees (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_code VARCHAR(50) UNIQUE,
      user_id UUID REFERENCES users(id),
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(50),
      date_of_birth DATE,
      gender VARCHAR(20),
      address TEXT,
      department_id UUID REFERENCES departments(id),
      designation VARCHAR(255),
      employment_type VARCHAR(50) DEFAULT 'full_time',
      joining_date DATE,
      exit_date DATE,
      status VARCHAR(50) DEFAULT 'active',
      base_salary NUMERIC DEFAULT 0,
      hourly_rate NUMERIC DEFAULT 0,
      bank_account_name VARCHAR(255),
      bank_account_number VARCHAR(255),
      bank_ifsc VARCHAR(50),
      work_start_time VARCHAR(10) DEFAULT '09:00',
      work_end_time VARCHAR(10) DEFAULT '18:00',
      working_days_per_week INTEGER DEFAULT 5,
      leave_annual INTEGER DEFAULT 12,
      leave_sick INTEGER DEFAULT 10,
      leave_casual INTEGER DEFAULT 6,
      leave_maternity INTEGER DEFAULT 90,
      leave_unpaid INTEGER DEFAULT 0,
      avatar TEXT,
      reporting_manager_id UUID REFERENCES employees(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID REFERENCES employees(id) NOT NULL,
      date DATE NOT NULL,
      check_in TIMESTAMPTZ,
      check_out TIMESTAMPTZ,
      status VARCHAR(50) DEFAULT 'absent',
      late_minutes INTEGER DEFAULT 0,
      overtime_minutes INTEGER DEFAULT 0,
      work_hours NUMERIC DEFAULT 0,
      notes TEXT,
      marked_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS leaves (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID REFERENCES employees(id) NOT NULL,
      leave_type VARCHAR(50) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      total_days NUMERIC NOT NULL,
      reason TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      approved_by UUID REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      rejection_reason TEXT,
      is_half_day BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payroll (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID REFERENCES employees(id) NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      period VARCHAR(20),
      base_salary NUMERIC DEFAULT 0,
      overtime_pay NUMERIC DEFAULT 0,
      bonus NUMERIC DEFAULT 0,
      allowance_hra NUMERIC DEFAULT 0,
      allowance_transport NUMERIC DEFAULT 0,
      allowance_medical NUMERIC DEFAULT 0,
      allowance_other NUMERIC DEFAULT 0,
      gross_salary NUMERIC DEFAULT 0,
      tax NUMERIC DEFAULT 0,
      provident_fund NUMERIC DEFAULT 0,
      insurance NUMERIC DEFAULT 0,
      late_deduction NUMERIC DEFAULT 0,
      loan_repayment NUMERIC DEFAULT 0,
      deduction_other NUMERIC DEFAULT 0,
      total_deductions NUMERIC DEFAULT 0,
      net_salary NUMERIC DEFAULT 0,
      working_days INTEGER DEFAULT 0,
      present_days INTEGER DEFAULT 0,
      absent_days INTEGER DEFAULT 0,
      leave_days INTEGER DEFAULT 0,
      overtime_hours NUMERIC DEFAULT 0,
      late_minutes INTEGER DEFAULT 0,
      status VARCHAR(50) DEFAULT 'draft',
      payment_date DATE,
      payment_method VARCHAR(50),
      generated_by UUID REFERENCES users(id),
      approved_by UUID REFERENCES users(id),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS company_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR(50) UNIQUE DEFAULT 'default',
      company_name VARCHAR(255) DEFAULT 'My Company',
      office_start_time VARCHAR(10) DEFAULT '10:00',
      office_end_time VARCHAR(10) DEFAULT '19:00',
      weekly_off_day VARCHAR(20) DEFAULT 'Sunday',
      timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS breaks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID REFERENCES employees(id) NOT NULL,
      user_id UUID REFERENCES users(id) NOT NULL,
      date DATE NOT NULL,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      duration_minutes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Database schema initialized');
};

module.exports = initDB;
