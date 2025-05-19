const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://phonelocator:phonelocator@cluster0.i9c1x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Connect to MongoDB with more robust connection options
mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    family: 4, // Use IPv4, skip trying IPv6
    maxPoolSize: 10, // Maintain up to 10 socket connections
    retryWrites: true,
    retryReads: true,
})
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        console.error('Connection string:', MONGO_URI.replace(/mongodb\+srv:\/\/[^:]+:[^@]+@/, 'mongodb+srv://username:password@'));
        console.log('Continuing application startup despite MongoDB connection issue');
    });

// Add connection event listeners
mongoose.connection.on('connected', () => {
    console.log('Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
    console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected');
});

// Add connection monitoring and auto-reconnect
let isConnectedBefore = false;
mongoose.connection.on('connected', function() {
    isConnectedBefore = true;
    console.log('Mongoose reconnection successful');
});

mongoose.connection.on('disconnected', function() {
    if (isConnectedBefore) {
        console.log('Mongoose disconnected, attempting to reconnect...');
        setTimeout(() => {
            mongoose.connect(MONGO_URI, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            }).catch(err => {
                console.error('Error reconnecting to MongoDB:', err);
            });
        }, 5000);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('MongoDB connection closed due to app termination');
    process.exit(0);
});

// Import models
const User = require('./User');
const Setting = require('./Setting');
const LookupHistory = require('./LookupHistory');
const ApiKey = require('./ApiKey');
const Proxy = require('./Proxy');

// Create User model if it doesn't exist
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

// Create Setting model if it doesn't exist
const settingSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: String,
    updated_at: { type: Date, default: Date.now }
});

// Create LookupHistory model if it doesn't exist
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

// Create ApiKey model if it doesn't exist
const apiKeySchema = new mongoose.Schema({
    value: { type: String, unique: true },
    is_active: { type: Number, default: 0 },
    usage_count: { type: Number, default: 0 },
    last_used: Date,
    created_at: { type: Date, default: Date.now }
});

// Register models only if they don't already exist
const UserModel = mongoose.models.User || mongoose.model('User', userSchema);
const SettingModel = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
const LookupHistoryModel = mongoose.models.LookupHistory || mongoose.model('LookupHistory', lookupHistorySchema);
const ApiKeyModel = mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema);
const ProxyModel = Proxy || mongoose.models.Proxy || mongoose.model('Proxy', mongoose.Schema({
    host: { type: String, required: true },
    port: { type: Number, required: true },
    username: String,
    password: String,
    is_active: { type: Number, default: 1 },
    last_checked: Date,
    status: { type: String, default: 'unknown' },
    error_message: String,
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}));

// Initialize default settings, API keys, etc.
const initializeDatabase = async () => {
    try {
        // Wait for connection to be ready
        if (mongoose.connection.readyState !== 1) {
            console.log('Waiting for MongoDB connection...');
            await new Promise((resolve) => {
                mongoose.connection.once('connected', resolve);
                
                // Set a timeout in case the connection never establishes
                setTimeout(() => {
                    if (mongoose.connection.readyState !== 1) {
                        console.warn('MongoDB connection timeout, continuing anyway');
                        resolve();
                    }
                }, 10000);
            });
        }
        
        // Return models for use in the application
        return { 
            User: UserModel, 
            Setting: SettingModel, 
            LookupHistory: LookupHistoryModel, 
            ApiKey: ApiKeyModel, 
            Proxy: ProxyModel 
        };
    } catch (error) {
        console.error('Failed to initialize database:', error);
        // Return models anyway so application can try to function
        return { 
            User: UserModel, 
            Setting: SettingModel, 
            LookupHistory: LookupHistoryModel, 
            ApiKey: ApiKeyModel, 
            Proxy: ProxyModel 
        };
    }
};

// Export all models and initialization function
module.exports = {
    User: UserModel,
    Setting: SettingModel,
    LookupHistory: LookupHistoryModel,
    ApiKey: ApiKeyModel,
    Proxy: ProxyModel,
    initializeDatabase
}; 