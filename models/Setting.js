const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: String,
    updated_at: { type: Date, default: Date.now }
});

const Setting = mongoose.model('Setting', settingSchema);
module.exports = Setting; 