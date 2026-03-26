const CompanySettings = require('../models/CompanySettings');

exports.get = async (req, res) => {
  try {
    let settings = await CompanySettings.findOne({ companyId: 'default' });
    if (!settings) settings = await CompanySettings.create({ companyId: 'default' });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { companyName, officeStartTime, officeEndTime, weeklyOffDay, timezone } = req.body;
    const settings = await CompanySettings.findOneAndUpdate(
      { companyId: 'default' },
      { companyName, officeStartTime, officeEndTime, weeklyOffDay, timezone },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
