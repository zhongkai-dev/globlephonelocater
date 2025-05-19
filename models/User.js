const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    telegram_id: { type: String, unique: true, required: true },
    username: String,
    first_name: String,
    last_name: String,
    is_blocked: { type: Number, default: 0 },
    check_limit: { type: Number, default: 1000 },
    daily_checks: { type: Number, default: 0 },
    last_check_date: String,
    created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
module.exports = User; 