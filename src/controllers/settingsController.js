const pool = require('../config/db');

exports.get = async (req, res) => {
  try {
    let r = await pool.query(`SELECT * FROM company_settings WHERE company_id='default'`);
    if (!r.rows[0]) {
      r = await pool.query(`INSERT INTO company_settings (company_id) VALUES ('default') RETURNING *`);
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { companyName, officeStartTime, officeEndTime, weeklyOffDay, timezone } = req.body;
    const r = await pool.query(
      `INSERT INTO company_settings (company_id,company_name,office_start_time,office_end_time,weekly_off_day,timezone)
       VALUES ('default',$1,$2,$3,$4,$5)
       ON CONFLICT (company_id) DO UPDATE SET
         company_name=COALESCE($1,company_settings.company_name),
         office_start_time=COALESCE($2,company_settings.office_start_time),
         office_end_time=COALESCE($3,company_settings.office_end_time),
         weekly_off_day=COALESCE($4,company_settings.weekly_off_day),
         timezone=COALESCE($5,company_settings.timezone),
         updated_at=NOW()
       RETURNING *`,
      [companyName||null, officeStartTime||null, officeEndTime||null, weeklyOffDay||null, timezone||null]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
