const mongoose = require('mongoose');

// Define proxy schema for proxy management
const proxySchema = new mongoose.Schema({
    host: { type: String, required: true },
    port: { type: Number, required: true },
    username: String,
    password: String,
    is_active: { type: Number, default: 1 },
    last_checked: Date,
    status: { type: String, default: 'unknown' }, // unknown, working, failed
    error_message: String,
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Add method to convert proxy to config object for axios
proxySchema.methods.toConfig = function() {
    const config = {
        host: this.host,
        port: this.port
    };
    
    if (this.username && this.password) {
        config.auth = {
            username: this.username,
            password: this.password
        };
    }
    
    return config;
};

// Create and export the model
const Proxy = mongoose.model('Proxy', proxySchema);
module.exports = Proxy; 