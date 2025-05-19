const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
    value: { type: String, unique: true },
    is_active: { type: Number, default: 0 },
    usage_count: { type: Number, default: 0 },
    last_used: Date,
    created_at: { type: Date, default: Date.now }
});

const ApiKey = mongoose.model('ApiKey', apiKeySchema);
module.exports = ApiKey; 