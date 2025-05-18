const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://phonelocator:phonelocator@cluster0.i9c1x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Connect to MongoDB with more robust connection options
mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: 10,
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

// Define schemas
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

// Add proxy schema for proxy management
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

const settingSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: String,
    updated_at: { type: Date, default: Date.now }
});

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

const apiKeySchema = new mongoose.Schema({
    value: { type: String, unique: true },
    is_active: { type: Number, default: 0 },
    usage_count: { type: Number, default: 0 },
    last_used: Date,
    created_at: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.model('User', userSchema);
const Setting = mongoose.model('Setting', settingSchema);
const LookupHistory = mongoose.model('LookupHistory', lookupHistorySchema);
const ApiKey = mongoose.model('ApiKey', apiKeySchema);
const Proxy = mongoose.model('Proxy', proxySchema);

// Initialize default settings and API keys
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
        
        // Check if settings exist, if not add default ones
        const settingsCount = await Setting.countDocuments();
        if (settingsCount === 0) {
            await Setting.insertMany([
                { key: 'veriphone_api_key', value: '4C9FBDA3C44247929DBC907666F638BC' },
                { key: 'bot_status', value: 'active' },
                { key: 'current_api_key_index', value: '0' },
                { key: 'default_daily_limit', value: '1000' }
            ]);
            console.log('Default settings initialized');
        }
        
        // Ensure default_daily_limit setting exists
        const defaultLimitSetting = await Setting.findOne({ key: 'default_daily_limit' });
        if (!defaultLimitSetting) {
            await Setting.create({
                key: 'default_daily_limit',
                value: '1000',
                updated_at: new Date()
            });
            console.log('Default daily limit setting created');
        }

        // Check if API keys exist, if not add default ones
        const apiKeysCount = await ApiKey.countDocuments();
        if (apiKeysCount === 0) {
            const apiKeys = [
                'C2C65540E34D42D9A1AE05D752B0BDB9',
                'F4F060B77E7C44EE903266ABD0BE501B',
                'E15BA6D4990E4F878AAD1BC6FB8C906A',
                'A1A6C980E090482BBB7DE90E6FDEB2E1',
                'A00AAF9E6A534B67A5C75BCDBE130381',
                'CF3902B91FFB4B34B1FAAC0ED7C57136',
                'F38E27BECE174CC5BDBE7AC024BBF6B5',
                '0BFC196529844002B7163110AFFC99A0',
                '4FC8E49789B646FEA5F74FB9EA768889',
                '234F2321259845CD9BA3C4009E394D17',
                'EDAB0B75C3FC40219B574DEC620E3BE3',
                '22A0D2E83DA0404AAC41D8036873E45B',
                '23C69B0BFE6C4AD7805400C0E12C21DE',
                '33B34020793C42899827CD964761D98F',
                '29F17961766E44A2B570F851CA1AD380',
                '8B035196E4B04C00B8D593F4F1DFDC56',
                '2A0CAD6044F24F9CAECDE4E2D5303047',
                '2EEBA2816B754C0CBA4D4179FB05EB5C',
                '960CD75A28B04097A54628F8A37CA018',
                '39BACE824D0146C88F72190965649F7B',
                '07EB798C11714725947E55CE04769821',
                '65558CB215924BAC8FD53CE1623D158D',
                '169AEA1C04FC4EB7964F9639B9B4470C',
                'FDF92242E6084820ACE653514E6D706D',
                '7B9056361E3F4A79AB4F41F5A9228CAF',
                'D690107B1E184267B5E902CE16830B88',
                'C487397E4BF7436280484A209606FF67',
                '779A1EEDE0B04B5A91973E2327C10C59',
                '0D7FDF01F1B54160889704DF05578FBF',
                '1CEF72277E354986AE431DB2338CEAD7',
                '73DB7DF7A6CC4ADB96D432412AED9B1F',
                '21AA62B1B119495A987818B16D9D705A',
                'F4550BE74907492684ED8D6E316F9577',
                'C2AB93B5599E4753A655A6C5C917FCE9',
                '1D918CE0987643818FC5DCF27686FE61',
                '4C9FBDA3C44247929DBC907666F638BC'
            ];
            
            const apiKeyObjects = apiKeys.map(value => ({ value }));
            await ApiKey.insertMany(apiKeyObjects);
            
            // Set first API key as active
            await ApiKey.updateOne(
                { value: apiKeys[0] },
                { is_active: 1 }
            );
            
            console.log('Default API keys initialized');
        }
        
        // Update all users to have 1000 daily limit
        await User.updateMany(
            { check_limit: { $ne: 1000 } },
            { $set: { check_limit: 1000 } }
        );
        console.log('Updated all users to have 1000 daily checks limit');
        
        // Reset users who have reached their limit today
        const today = new Date().toISOString().split('T')[0];
        await User.updateMany(
            { 
                last_check_date: today,
                $expr: { $gte: ['$daily_checks', '$check_limit'] }
            },
            { 
                $set: { daily_checks: 0, last_check_date: today }
            }
        );
        console.log('Reset daily checks for users who had reached their previous limit');
        
        return { User, Proxy, LookupHistory, ApiKey, Setting };
    } catch (error) {
        console.error('Failed to initialize database:', error);
        return { User, Proxy, LookupHistory, ApiKey, Setting };
    }
};

// Export models and initialization function
module.exports = {
    User,
    Setting,
    LookupHistory,
    ApiKey,
    Proxy,
    initializeDatabase
}; 