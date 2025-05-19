const mongoose = require('mongoose');

const lookupHistorySchema = new mongoose.Schema({
    user_id: { 
        type: String, 
        ref: 'User',
        // This is critical - it tells Mongoose not to try converting the string to ObjectId
        get: v => v,
        set: v => v
    },
    phone_number: String,
    country: String,
    region: String,
    carrier: String,
    carrier_type: String,
    is_valid: Number,
    created_at: { type: Date, default: Date.now }
});

const LookupHistory = mongoose.model('LookupHistory', lookupHistorySchema);
module.exports = LookupHistory; 