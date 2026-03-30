const pool = require('../config/db');

const fmt = (r) => {
  if (!r) return null;
  return {
    companyId: r.company_id,
    companyName: r.company_name,
    // Office Timing
    officeStartTime: r.office_start_time,
    officeEndTime: r.office_end_time,
    weeklyOffDay: r.weekly_off_day,
    timezone: r.timezone,
    // Attendance Rules
    gracePeriodMinutes: r.grace_period_minutes ?? 15,
    halfDayAfterMinutes: r.half_day_after_minutes ?? 240,
    absentAfterMinutes: r.absent_after_minutes ?? 480,
    // Salary Rules
    lateCountForHalfDay: r.late_count_for_half_day ?? 3,
    overtimeMultiplier: parseFloat(r.overtime_multiplier) || 1.5,
    hraPercent: parseFloat(r.hra_percent) || 10,
    transportAllowance: parseFloat(r.transport_allowance) || 1500,
    medicalAllowance: parseFloat(r.medical_allowance) || 1000,
    pfPercent: parseFloat(r.pf_percent) || 12,
    taxPercent: parseFloat(r.tax_percent) || 10,
    taxThreshold: parseFloat(r.tax_threshold) || 50000,
    // Leave Policy
    monthlyLeaveLimit: r.monthly_leave_limit ?? 2,
    sickLeaveLimit: r.sick_leave_limit ?? 1,
    casualLeaveLimit: r.casual_leave_limit ?? 2,
    leaveIsPaid: r.leave_is_paid ?? true,
    leaveApprovalRequired: r.leave_approval_required ?? true,
    // Policies
    companyPolicies: r.company_policies || '',
  };
};

exports.get = async (req, res) => {
  try {
    let r = await pool.query(`SELECT * FROM company_settings WHERE company_id='default'`);
    if (!r.rows[0]) {
      r = await pool.query(`INSERT INTO company_settings (company_id) VALUES ('default') RETURNING *`);
    }
    res.json({ success: true, data: fmt(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const {
      companyName, officeStartTime, officeEndTime, weeklyOffDay, timezone,
      gracePeriodMinutes, halfDayAfterMinutes, absentAfterMinutes,
      lateCountForHalfDay, overtimeMultiplier, hraPercent,
      transportAllowance, medicalAllowance, pfPercent, taxPercent, taxThreshold,
      monthlyLeaveLimit, sickLeaveLimit, casualLeaveLimit, leaveIsPaid, leaveApprovalRequired,
      companyPolicies,
    } = req.body;

    const r = await pool.query(
      `INSERT INTO company_settings (company_id,company_name,office_start_time,office_end_time,weekly_off_day,timezone,
        grace_period_minutes,half_day_after_minutes,absent_after_minutes,
        late_count_for_half_day,overtime_multiplier,hra_percent,transport_allowance,medical_allowance,
        pf_percent,tax_percent,tax_threshold,
        monthly_leave_limit,sick_leave_limit,casual_leave_limit,leave_is_paid,leave_approval_required,company_policies)
       VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (company_id) DO UPDATE SET
         company_name=COALESCE($1,company_settings.company_name),
         office_start_time=COALESCE($2,company_settings.office_start_time),
         office_end_time=COALESCE($3,company_settings.office_end_time),
         weekly_off_day=COALESCE($4,company_settings.weekly_off_day),
         timezone=COALESCE($5,company_settings.timezone),
         grace_period_minutes=COALESCE($6,company_settings.grace_period_minutes),
         half_day_after_minutes=COALESCE($7,company_settings.half_day_after_minutes),
         absent_after_minutes=COALESCE($8,company_settings.absent_after_minutes),
         late_count_for_half_day=COALESCE($9,company_settings.late_count_for_half_day),
         overtime_multiplier=COALESCE($10,company_settings.overtime_multiplier),
         hra_percent=COALESCE($11,company_settings.hra_percent),
         transport_allowance=COALESCE($12,company_settings.transport_allowance),
         medical_allowance=COALESCE($13,company_settings.medical_allowance),
         pf_percent=COALESCE($14,company_settings.pf_percent),
         tax_percent=COALESCE($15,company_settings.tax_percent),
         tax_threshold=COALESCE($16,company_settings.tax_threshold),
         monthly_leave_limit=COALESCE($17,company_settings.monthly_leave_limit),
         sick_leave_limit=COALESCE($18,company_settings.sick_leave_limit),
         casual_leave_limit=COALESCE($19,company_settings.casual_leave_limit),
         leave_is_paid=COALESCE($20,company_settings.leave_is_paid),
         leave_approval_required=COALESCE($21,company_settings.leave_approval_required),
         company_policies=COALESCE($22,company_settings.company_policies),
         updated_at=NOW()
       RETURNING *`,
      [
        companyName ?? null, officeStartTime ?? null, officeEndTime ?? null, weeklyOffDay ?? null, timezone ?? null,
        gracePeriodMinutes ?? null, halfDayAfterMinutes ?? null, absentAfterMinutes ?? null,
        lateCountForHalfDay ?? null, overtimeMultiplier ?? null, hraPercent ?? null,
        transportAllowance ?? null, medicalAllowance ?? null, pfPercent ?? null, taxPercent ?? null, taxThreshold ?? null,
        monthlyLeaveLimit ?? null, sickLeaveLimit ?? null, casualLeaveLimit ?? null,
        leaveIsPaid != null ? leaveIsPaid : null,
        leaveApprovalRequired != null ? leaveApprovalRequired : null,
        companyPolicies ?? null,
      ]
    );
    res.json({ success: true, data: fmt(r.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Helper: get settings as raw DB row for internal use by other controllers
exports.getSettings = async () => {
  const r = await pool.query(`SELECT * FROM company_settings WHERE company_id='default'`);
  if (r.rows[0]) return r.rows[0];
  const ins = await pool.query(`INSERT INTO company_settings (company_id) VALUES ('default') RETURNING *`);
  return ins.rows[0];
};
