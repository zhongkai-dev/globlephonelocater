const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const ejs = require('ejs');
const { User, Setting, LookupHistory, ApiKey, Proxy, ChannelPost } = require('../models');
const axios = require('axios');
const mongoose = require('mongoose');

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.authenticated) {
        return next();
    }
    res.redirect('/admin/login');
};

// Login page
router.get('/login', (req, res) => {
    res.render('admin/login', { 
        title: 'Login',
        activePage: '',
        layout: false
    });
});

// Login handler
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && 
        password === process.env.ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { 
            error: 'Invalid credentials',
            title: 'Login',
            activePage: '',
            layout: false
        });
    }
});

// Dashboard
router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        // Get stats
        const stats = await getStats();
        
        // Get recent lookups - using raw query to avoid ObjectId conversion issues
        const recentLookups = await LookupHistory.find()
            .sort({ created_at: -1 })
            .limit(10);
            
        // Manually get user information for each lookup
        const enrichedLookups = await Promise.all(recentLookups.map(async (lookup) => {
            const user = await User.findOne({ telegram_id: lookup.user_id });
            return {
                ...lookup.toObject(),
                user: user ? { 
                    username: user.username,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    telegram_id: user.telegram_id
                } : null
            };
        }));
        
        // Get active API key
        const apiKey = await Setting.findOne({ key: 'veriphone_api_key' }) || 
            { value: '', updated_at: new Date() };
        
        // Get bot status
        const botStatus = await Setting.findOne({ key: 'bot_status' });
        const status = botStatus ? botStatus.value : 'active';
        
        res.render('admin/dashboard', {
            title: 'Dashboard',
            activePage: 'dashboard',
            stats,
            recentLookups: enrichedLookups,
            apiKey: apiKey.value,
            botStatus: status
        });
    } catch (error) {
        console.error('Error rendering dashboard:', error);
        res.status(500).send('Error loading dashboard: ' + error.message);
    }
});

// Users management
router.get('/users', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        const search = req.query.q || '';
        
        // Create search query
        const searchQuery = search ? {
            $or: [
                { username: { $regex: search, $options: 'i' } },
                { first_name: { $regex: search, $options: 'i' } },
                { last_name: { $regex: search, $options: 'i' } },
                { telegram_id: { $regex: search, $options: 'i' } }
            ]
        } : {};
        
        // Get total users count
        const totalCount = await User.countDocuments(searchQuery);
        
        // Get users with aggregation to count their lookups
        const users = await User.aggregate([
            { $match: searchQuery },
            {
                $lookup: {
                    from: 'lookuphistories',
                    let: { telegram_id: '$telegram_id' },
                    pipeline: [
                        { 
                            $match: {
                                $expr: { $eq: ['$user_id', '$$telegram_id'] }
                            }
                        }
                    ],
                    as: 'lookups'
                }
            },
            {
                $addFields: {
                    lookup_count: { $size: '$lookups' }
                }
            },
            {
                $project: {
                    lookups: 0
                }
            },
            { $sort: { created_at: -1 } },
            { $skip: skip },
            { $limit: limit }
        ]);
        
        // Get default daily limit from settings
        const defaultLimitSetting = await Setting.findOne({ key: 'default_daily_limit' });
        const defaultLimit = defaultLimitSetting ? parseInt(defaultLimitSetting.value) : 1000;
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.render('admin/users', {
            title: 'User Management',
            activePage: 'users',
            users,
            pagination: {
                currentPage: page,
                totalPages,
                totalCount
            },
            search,
            defaultLimit,
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages after sending to template
        req.session.error = null;
        req.session.success = null;
    } catch (error) {
        console.error('Error rendering users page:', error);
        res.status(500).send('Error loading users: ' + error.message);
    }
});

// User details
router.get('/users/:id', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Get user
        const user = await User.findOne({ telegram_id: userId });
        if (!user) {
            throw new Error('User not found');
        }
        
        // Get user stats
        const stats = await LookupHistory.aggregate([
            { $match: { user_id: userId } },
            {
                $group: {
                    _id: null,
                    totalLookups: { $sum: 1 },
                    validLookups: { $sum: { $cond: [{ $eq: ['$is_valid', 1] }, 1, 0] } },
                    invalidLookups: { $sum: { $cond: [{ $eq: ['$is_valid', 0] }, 1, 0] } }
                }
            }
        ]);
        
        const userStats = stats.length > 0 ? stats[0] : { 
            totalLookups: 0, 
            validLookups: 0, 
            invalidLookups: 0 
        };
        
        // Get recent lookup history using string comparison for user_id
        const lookupHistory = await LookupHistory.find({ user_id: userId.toString() })
            .sort({ created_at: -1 })
            .limit(10);
        
        res.render('admin/user-detail', {
            title: `User: ${user.username || user.first_name || user.telegram_id}`,
            activePage: 'users',
            user,
            stats: userStats,
            lookupHistory
        });
    } catch (error) {
        console.error('Error rendering user detail page:', error);
        res.status(500).send('Error loading user details: ' + error.message);
    }
});

// Block/unblock user
router.post('/users/:id/toggle-block', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Get current block status
        const user = await User.findOne({ telegram_id: userId });
        if (!user) {
            throw new Error('User not found');
        }
        
        // Toggle block status
        const newStatus = user.is_blocked === 1 ? 0 : 1;
        
        // Update user
        await User.updateOne(
            { telegram_id: userId },
            { $set: { is_blocked: newStatus } }
        );
        
        res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        console.error('Error toggling user block status:', error);
        res.status(500).send('Error updating user');
    }
});

// Update user check limit
router.post('/users/:id/update-limit', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        const { check_limit } = req.body;
        
        // Convert to number
        const limit = parseInt(check_limit);
        if (isNaN(limit) || limit < 1) {
            throw new Error('Invalid limit value');
        }
        
        // Update user
        await User.updateOne(
            { telegram_id: userId },
            { $set: { check_limit: limit } }
        );
        
        res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        console.error('Error updating user check limit:', error);
        res.status(500).send('Error updating user limit');
    }
});

// Reset user daily checks
router.post('/users/:id/reset-checks', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Reset daily checks
        await User.updateOne(
            { telegram_id: userId },
            { $set: { daily_checks: 0 } }
        );
        
        res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        console.error('Error resetting user daily checks:', error);
        res.status(500).send('Error resetting user checks');
    }
});

// Update default daily limit for all users
router.post('/users/update-default-limit', isAuthenticated, async (req, res) => {
    try {
        const { default_limit } = req.body;
        
        // Validate limit
        const newLimit = parseInt(default_limit);
        if (isNaN(newLimit) || newLimit < 1) {
            req.session.error = 'Invalid limit value';
            return res.redirect('/admin/users');
        }
        
        // Update all users with new limit
        await User.updateMany(
            {}, // Match all users
            { $set: { check_limit: newLimit } }
        );
        
        // Save the default limit to settings
        await Setting.updateOne(
            { key: 'default_daily_limit' },
            { $set: { value: newLimit.toString(), updated_at: new Date() } },
            { upsert: true }
        );
        
        // Set success message
        req.session.success = `Successfully updated all users to have a daily limit of ${newLimit} checks`;
        
        res.redirect('/admin/users');
    } catch (error) {
        console.error('Error updating default daily limit:', error);
        req.session.error = 'Error updating default daily limit: ' + error.message;
        res.redirect('/admin/users');
    }
});

// Toggle user block status
router.post('/toggle-user/:id', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Get current block status
        const user = await User.findOne({ telegram_id: userId });
        if (!user) {
            throw new Error('User not found');
        }
        
        // Toggle block status
        const newStatus = user.is_blocked === 1 ? 0 : 1;
        
        // Update user
        await User.updateOne(
            { telegram_id: userId },
            { $set: { is_blocked: newStatus } }
        );
        
        // Redirect back to the user list or user detail page depending on referer
        const referer = req.headers.referer || '/admin/users';
        res.redirect(referer);
    } catch (error) {
        console.error('Error toggling user block status:', error);
        res.status(500).send('Error updating user');
    }
});

// API Keys management
router.get('/api-keys', isAuthenticated, async (req, res) => {
    try {
        // Get all API keys
        const apiKeys = await ApiKey.find().sort({ created_at: -1 });
        
        // Ensure each API key has the required fields to prevent rendering errors
        const processedApiKeys = apiKeys.map(key => {
            return {
                _id: key._id,
                value: key.value || '',
                is_active: key.is_active || 0,
                usage_count: key.usage_count || 0,
                last_used: key.last_used || new Date(),
                created_at: key.created_at || new Date()
            };
        });
        
        // Get active API key from settings
        const apiKey = await Setting.findOne({ key: 'veriphone_api_key' }) || 
            { value: '', updated_at: new Date() };
        
        res.render('admin/api-keys', {
            title: 'API Keys Management',
            activePage: 'api-keys',
            apiKeys: processedApiKeys,
            apiKey: apiKey.value,
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        req.session.error = null;
        req.session.success = null;
    } catch (error) {
        console.error('Error rendering API keys page:', error);
        res.status(500).send('Error loading API keys: ' + error.message);
    }
});

// Helper function to safely use flash
function safeFlash(req, type, message) {
    if (req.flash) {
        return req.flash(type, message);
    } else if (req.session) {
        // Simple fallback implementation
        if (!req.session.flash) req.session.flash = {};
        if (!req.session.flash[type]) req.session.flash[type] = [];
        if (message) req.session.flash[type].push(message);
        return req.session.flash[type] || [];
    }
    // If no session either, just log to console
    console.log(`Flash message (${type}):`, message);
    return [];
}

// Add API key
router.post('/api-keys/add', isAuthenticated, async (req, res) => {
    try {
        const { api_key } = req.body;
        
        // Check if key already exists
        const existingKey = await ApiKey.findOne({ value: api_key });
        if (existingKey) {
            req.session.error = 'API key already exists';
        } else {
            // Add key
            await ApiKey.create({ value: api_key });
            req.session.success = 'API key added';
        }
        
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error adding API key:', error);
        req.session.error = 'Error adding API key';
        res.redirect('/admin/api-keys');
    }
});

// Toggle API key status
router.post('/api-keys/:id/toggle', isAuthenticated, async (req, res) => {
    try {
        const keyId = req.params.id;
        
        // Get current status
        const apiKey = await ApiKey.findById(keyId);
        if (!apiKey) {
            throw new Error('API key not found');
        }
        
        // Toggle status
        const newStatus = apiKey.is_active === 1 ? 0 : 1;
        
        // Update key
        await ApiKey.updateOne(
            { _id: keyId },
            { $set: { is_active: newStatus } }
        );
        
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error toggling API key status:', error);
        res.status(500).send('Error updating API key: ' + error.message);
    }
});

// Activate all API keys
router.post('/api-keys/activate-all', isAuthenticated, async (req, res) => {
    try {
        // Update all keys to active
        await ApiKey.updateMany({}, { $set: { is_active: 1 } });
        
        req.session.success = 'All API keys activated';
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error activating all API keys:', error);
        req.session.error = 'Error activating API keys';
        res.redirect('/admin/api-keys');
    }
});

// Deactivate all API keys
router.post('/api-keys/deactivate-all', isAuthenticated, async (req, res) => {
    try {
        // Update all keys to inactive
        await ApiKey.updateMany({}, { $set: { is_active: 0 } });
        
        req.session.success = 'All API keys deactivated';
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error deactivating all API keys:', error);
        req.session.error = 'Error deactivating API keys';
        res.redirect('/admin/api-keys');
    }
});

// Update primary API key
router.post('/update-api-key', isAuthenticated, async (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!apiKey) {
            req.session.error = 'API key cannot be empty';
            return res.redirect('/admin/api-keys');
        }
        
        // Update the primary API key in settings
        await Setting.updateOne(
            { key: 'veriphone_api_key' },
            { $set: { value: apiKey, updated_at: new Date() } },
            { upsert: true }
        );
        
        req.session.success = 'Primary API key updated';
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error updating primary API key:', error);
        req.session.error = 'Error updating primary API key';
        res.redirect('/admin/api-keys');
    }
});

// Delete API key
router.post('/api-keys/:id/delete', isAuthenticated, async (req, res) => {
    try {
        const keyId = req.params.id;
        
        // Delete key
        await ApiKey.deleteOne({ _id: keyId });
        
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.status(500).send('Error deleting API key');
    }
});

// Settings page
router.get('/settings', isAuthenticated, async (req, res) => {
    try {
        // Get all settings
        const settings = await Setting.find();
        
        // Convert to key-value map
        const settingsMap = {};
        settings.forEach(setting => {
            settingsMap[setting.key] = setting.value;
        });
        
        res.render('admin/settings', {
            title: 'Settings',
            activePage: 'settings',
            settings: settingsMap
        });
    } catch (error) {
        console.error('Error rendering settings page:', error);
        res.status(500).send('Error loading settings');
    }
});

// Update settings
router.post('/settings/update', isAuthenticated, async (req, res) => {
    try {
        const { veriphone_api_key, bot_status, telegram_channel_id, default_daily_limit } = req.body;
        
        // Update settings
        await Setting.updateOne(
            { key: 'veriphone_api_key' },
            { $set: { value: veriphone_api_key, updated_at: new Date() } },
            { upsert: true }
        );
        
        await Setting.updateOne(
            { key: 'bot_status' },
            { $set: { value: bot_status, updated_at: new Date() } },
            { upsert: true }
        );

        await Setting.updateOne(
            { key: 'telegram_channel_id' },
            { $set: { value: telegram_channel_id, updated_at: new Date() } },
            { upsert: true }
        );

        if (default_daily_limit) {
            await Setting.updateOne(
                { key: 'default_daily_limit' },
                { $set: { value: default_daily_limit.toString(), updated_at: new Date() } },
                { upsert: true }
            );
        }
        
        req.session.success = 'Settings updated successfully';
        res.redirect('/admin/settings');
    } catch (error) {
        console.error('Error updating settings:', error);
        req.session.error = 'Error updating settings';
        res.redirect('/admin/settings');
    }
});

// Statistics page
router.get('/statistics', isAuthenticated, async (req, res) => {
    try {
        // Get overall stats
        const stats = await getStats();
        
        // Get daily stats for past 7 days
        const dateLabels = [];
        const dateData = {
            total: [],
            valid: [],
            invalid: []
        };
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = date.toISOString().split('T')[0];
            dateLabels.push(dateString);
            
            // Format for MongoDB date query
            const startOfDay = new Date(dateString);
            const endOfDay = new Date(dateString);
            endOfDay.setHours(23, 59, 59, 999);
            
            const dayStats = await LookupHistory.aggregate([
                {
                    $match: {
                        created_at: {
                            $gte: startOfDay,
                            $lte: endOfDay
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        valid: { $sum: { $cond: [{ $eq: ['$is_valid', 1] }, 1, 0] } },
                        invalid: { $sum: { $cond: [{ $eq: ['$is_valid', 0] }, 1, 0] } }
                    }
                }
            ]);
            
            const dayStat = dayStats.length > 0 ? dayStats[0] : { total: 0, valid: 0, invalid: 0 };
            dateData.total.push(dayStat.total);
            dateData.valid.push(dayStat.valid);
            dateData.invalid.push(dayStat.invalid);
        }
        
        // Get carrier stats
        const carrierStats = await LookupHistory.aggregate([
            { $match: { carrier_type: { $ne: null } } },
            {
                $group: {
                    _id: '$carrier_type',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);
        
        // Format carrier data for chart
        const carrierLabels = carrierStats.map(item => item._id || 'unknown');
        const carrierData = carrierStats.map(item => item.count);
        
        res.render('admin/statistics', {
            title: 'Statistics',
            activePage: 'statistics',
            stats,
            dateLabels: JSON.stringify(dateLabels),
            dateData: JSON.stringify(dateData),
            carrierLabels: JSON.stringify(carrierLabels),
            carrierData: JSON.stringify(carrierData)
        });
    } catch (error) {
        console.error('Error rendering statistics page:', error);
        res.status(500).send('Error loading statistics');
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Get stats for dashboard
async function getStats() {
    try {
        // Total users
        const totalUsers = await User.countDocuments();
        
        // Total lookups
        const totalLookups = await LookupHistory.countDocuments();
        
        // Total valid lookups
        const validLookups = await LookupHistory.countDocuments({ is_valid: 1 });
        
        // Total invalid lookups
        const invalidLookups = await LookupHistory.countDocuments({ is_valid: 0 });
        
        // Today's lookups
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayLookups = await LookupHistory.countDocuments({
            created_at: { $gte: today }
        });
        
        // Users who reached daily limit today
        const todayString = today.toISOString().split('T')[0];
        const limitReachedUsers = await User.countDocuments({
            last_check_date: todayString,
            $expr: { $gte: ['$daily_checks', '$check_limit'] }
        });
        
        // Active users today
        const activeUsers = await LookupHistory.aggregate([
            { $match: { created_at: { $gte: today } } },
            { $group: { _id: '$user_id' } },
            { $count: 'count' }
        ]);
        
        const activeUserCount = activeUsers.length > 0 ? activeUsers[0].count : 0;
        
        // Get carrier statistics
        const carrierStats = await LookupHistory.aggregate([
            {
                $group: {
                    _id: '$carrier_type',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        // Extract stats for each carrier type
        const tmobileCount = carrierStats.find(item => item._id === 'tmobile')?.count || 0;
        const attCount = carrierStats.find(item => item._id === 'att')?.count || 0;
        const verizonCount = carrierStats.find(item => item._id === 'verizon')?.count || 0;
        const otherCount = carrierStats.find(item => item._id === 'other')?.count || 0;
        
        return {
            totalUsers,
            totalLookups,
            validLookups,
            invalidLookups,
            todayLookups,
            limitReachedUsers,
            activeUsers: activeUserCount,
            // Add carrier statistics to the returned object
            carrierStats: {
                tmobileCount,
                attCount,
                verizonCount,
                otherCount
            }
        };
    } catch (error) {
        console.error('Error getting stats:', error);
        return {
            totalUsers: 0,
            totalLookups: 0,
            validLookups: 0,
            invalidLookups: 0,
            todayLookups: 0,
            limitReachedUsers: 0,
            activeUsers: 0,
            // Provide default carrier stats to prevent errors
            carrierStats: {
                tmobileCount: 0,
                attCount: 0,
                verizonCount: 0,
                otherCount: 0
            }
        };
    }
}

// Helper function to render a view as a string
async function renderView(viewPath, data = {}) {
    try {
        const fullPath = path.join(__dirname, '../views', viewPath);
        return new Promise((resolve, reject) => {
            ejs.renderFile(fullPath, data, (err, result) => {
                if (err) reject(err);
                resolve(result);
            });
        });
    } catch (error) {
        console.error('Error rendering view:', error);
        return '';
    }
}

// Add History page
router.get('/history', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        
        // Get total count for pagination
        const totalCount = await LookupHistory.countDocuments();
        
        // Get lookup history with user information
        const lookupHistory = await LookupHistory.find()
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit);
            
        // Manually get user information for each lookup
        const enrichedHistory = await Promise.all(lookupHistory.map(async (lookup) => {
            const user = await User.findOne({ telegram_id: lookup.user_id });
            return {
                ...lookup.toObject(),
                user: user ? { 
                    username: user.username,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    telegram_id: user.telegram_id
                } : { 
                    username: 'Unknown',
                    telegram_id: lookup.user_id 
                }
            };
        }));
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.render('admin/history', {
            title: 'Lookup History',
            activePage: 'history',
            history: enrichedHistory,
            pagination: {
                currentPage: page,
                totalPages,
                totalCount
            }
        });
    } catch (error) {
        console.error('Error rendering history page:', error);
        res.status(500).send('Error loading lookup history: ' + error.message);
    }
});

// Bot control routes
router.post('/bot/start', isAuthenticated, async (req, res) => {
    try {
        await Setting.updateOne(
            { key: 'bot_status' },
            { $set: { value: 'active' } },
            { upsert: true }
        );
        
        req.session.success = 'Bot has been started';
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error starting bot:', error);
        req.session.error = 'Error starting bot: ' + error.message;
        res.redirect('/admin/dashboard');
    }
});

router.post('/bot/stop', isAuthenticated, async (req, res) => {
    try {
        await Setting.updateOne(
            { key: 'bot_status' },
            { $set: { value: 'inactive' } },
            { upsert: true }
        );
        
        req.session.success = 'Bot has been stopped';
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error stopping bot:', error);
        req.session.error = 'Error stopping bot: ' + error.message;
        res.redirect('/admin/dashboard');
    }
});

// Proxy management routes
router.get('/proxies', isAuthenticated, async (req, res) => {
    try {
        console.log('Accessing proxies route...');
        
        // Check MongoDB connection first
        if (mongoose.connection.readyState !== 1) {
            console.error('MongoDB not connected - readyState:', mongoose.connection.readyState);
            throw new Error('Database connection is not active');
        }
        
        console.log('MongoDB connection OK, fetching proxies...');
        const proxies = await Proxy.find().lean().sort({ host: 1 });
        console.log(`Found ${proxies ? proxies.length : 'null'} proxies`);
        
        // Get flash messages safely
        let message = null;
        if (req.session && req.session.flash && req.session.flash.message) {
            message = req.session.flash.message[0];
            delete req.session.flash.message;
        }
        
        // Handle potential template issues
        try {
            res.render('admin/proxies', {
                title: 'Proxy Management',
                active: 'proxies',
                activePage: 'proxies',
                proxies: proxies || [],
                message: message
            });
        } catch (renderError) {
            console.error('Error rendering proxies template:', renderError);
            res.status(500).send(`Error rendering proxies template: ${renderError.message}`);
        }
    } catch (error) {
        console.error('Error in proxies route:', error);
        // Send detailed error for debugging
        res.status(500).send(`Error loading proxies: ${error.stack || error.message}`);
    }
});

// Add new proxy
router.post('/proxies/add', isAuthenticated, async (req, res) => {
    try {
        const { host, port, username, password } = req.body;
        
        // Validate input
        if (!host || !port) {
            safeFlash(req, 'message', { type: 'danger', text: 'Host and port are required' });
            return res.redirect('/admin/proxies');
        }
        
        // Check if proxy already exists
        const existingProxy = await Proxy.findOne({ host, port });
        if (existingProxy) {
            safeFlash(req, 'message', { type: 'warning', text: 'Proxy with this host and port already exists' });
            return res.redirect('/admin/proxies');
        }
        
        // Create new proxy
        const proxy = new Proxy({
            host,
            port: parseInt(port),
            username: username || null,
            password: password || null,
            status: 'unknown',
            created_at: new Date(),
            updated_at: new Date()
        });
        
        await proxy.save();
        safeFlash(req, 'message', { type: 'success', text: 'Proxy added successfully' });
        res.redirect('/admin/proxies');
    } catch (error) {
        console.error('Error adding proxy:', error);
        safeFlash(req, 'message', { type: 'danger', text: 'Error adding proxy: ' + error.message });
        res.redirect('/admin/proxies');
    }
});

// Edit proxy
router.post('/proxies/edit', isAuthenticated, async (req, res) => {
    try {
        const { id, host, port, username, password } = req.body;
        
        // Validate input
        if (!id || !host || !port) {
            safeFlash(req, 'message', { type: 'danger', text: 'Invalid proxy data' });
            return res.redirect('/admin/proxies');
        }
        
        // Update proxy
        await Proxy.findByIdAndUpdate(id, {
            host,
            port: parseInt(port),
            username: username || null,
            password: password || null,
            updated_at: new Date()
        });
        
        safeFlash(req, 'message', { type: 'success', text: 'Proxy updated successfully' });
        res.redirect('/admin/proxies');
    } catch (error) {
        console.error('Error updating proxy:', error);
        safeFlash(req, 'message', { type: 'danger', text: 'Error updating proxy: ' + error.message });
        res.redirect('/admin/proxies');
    }
});

// Delete proxy
router.post('/proxies/delete', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.body;
        
        await Proxy.findByIdAndDelete(id);
        
        safeFlash(req, 'message', { type: 'success', text: 'Proxy deleted successfully' });
        res.redirect('/admin/proxies');
    } catch (error) {
        console.error('Error deleting proxy:', error);
        safeFlash(req, 'message', { type: 'danger', text: 'Error deleting proxy: ' + error.message });
        res.redirect('/admin/proxies');
    }
});

// Test proxy functionality
router.post('/proxies/test', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.body;
        
        // Find the proxy by ID
        const proxy = await Proxy.findById(id);
        if (!proxy) {
            return res.json({ 
                success: false, 
                message: 'Proxy not found' 
            });
        }
        
        // Configure proxy settings for axios
        const axiosConfig = {
            proxy: {
                host: proxy.host,
                port: proxy.port
            },
            timeout: 10000 // 10 seconds timeout
        };
        
        // Add authentication if provided
        if (proxy.username && proxy.password) {
            axiosConfig.proxy.auth = {
                username: proxy.username,
                password: proxy.password
            };
        }
        
        try {
            // Test proxy with a request to sent.dm API
            const testUrl = 'https://www.sent.dm/api/test-proxy';
            
            // Try to make request through the proxy
            const response = await axios.get(testUrl, axiosConfig);
            
            // Update proxy status to working
            await Proxy.findByIdAndUpdate(id, {
                status: 'working',
                last_checked: new Date(),
                error_message: null,
                updated_at: new Date()
            });
            
            return res.json({ 
                success: true, 
                working: true,
                message: 'Proxy is working correctly' 
            });
        } catch (error) {
            // Update proxy status to failed
            const errorMessage = error.message || 'Connection failed';
            
            await Proxy.findByIdAndUpdate(id, {
                status: 'failed',
                last_checked: new Date(),
                error_message: errorMessage,
                updated_at: new Date()
            });
            
            return res.json({ 
                success: true, 
                working: false,
                error: errorMessage,
                message: `Proxy test failed: ${errorMessage}` 
            });
        }
    } catch (error) {
        console.error('Error testing proxy:', error);
        return res.json({ 
            success: false, 
            message: 'Server error while testing proxy: ' + error.message 
        });
    }
});

// Update existing proxySystem in index.js with proxies from the database
router.post('/proxies/sync', isAuthenticated, async (req, res) => {
    try {
        // Get all active proxies
        const activeProxies = await Proxy.find({ 
            is_active: 1,
            status: 'working' 
        });
        
        // Format message based on result
        let message;
        if (activeProxies.length === 0) {
            message = 'No active working proxies found to sync';
        } else {
            message = `Synced ${activeProxies.length} proxies with the bot successfully`;
            
            // Update global proxySystem (if you have access to that variable)
            // This part requires the proxySystem to be accessible or through some message passing
            global.updateProxies?.(activeProxies);
        }
        
        safeFlash(req, 'message', { type: 'success', text: message });
        res.redirect('/admin/proxies');
    } catch (error) {
        console.error('Error syncing proxies:', error);
        safeFlash(req, 'message', { type: 'danger', text: 'Error syncing proxies: ' + error.message });
        res.redirect('/admin/proxies');
    }
});

// Channel Posts
router.get('/channel-posts', isAuthenticated, async (req, res) => {
    try {
        // Get all posts
        const posts = await ChannelPost.find().sort({ created_at: -1 });
        
        res.render('admin/channel-posts', {
            title: 'Channel Posts',
            activePage: 'channel-posts',
            posts,
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        req.session.error = null;
        req.session.success = null;
    } catch (error) {
        console.error('Error loading channel posts:', error);
        res.status(500).send('Error loading channel posts: ' + error.message);
    }
});

// Add new post
router.post('/channel-posts/add', isAuthenticated, async (req, res) => {
    try {
        const { title, content, image_url, buttons } = req.body;
        
        // Parse buttons if provided
        let parsedButtons = [];
        if (buttons) {
            try {
                parsedButtons = JSON.parse(buttons);
            } catch (err) {
                console.error('Error parsing buttons:', err);
            }
        }
        
        // Create new post
        await ChannelPost.create({
            title,
            content,
            image_url: image_url || null,
            buttons: parsedButtons,
            status: 'draft',
            created_at: new Date(),
            updated_at: new Date()
        });
        
        req.session.success = 'Post created successfully';
        res.redirect('/admin/channel-posts');
    } catch (error) {
        console.error('Error creating post:', error);
        req.session.error = 'Error creating post: ' + error.message;
        res.redirect('/admin/channel-posts');
    }
});

// Edit post
router.post('/channel-posts/edit', isAuthenticated, async (req, res) => {
    try {
        const { post_id, title, content, image_url, buttons } = req.body;
        
        // Parse buttons if provided
        let parsedButtons = [];
        if (buttons) {
            try {
                parsedButtons = JSON.parse(buttons);
            } catch (err) {
                console.error('Error parsing buttons:', err);
            }
        }
        
        // Update post
        await ChannelPost.findByIdAndUpdate(post_id, {
            title,
            content,
            image_url: image_url || null,
            buttons: parsedButtons,
            updated_at: new Date()
        });
        
        req.session.success = 'Post updated successfully';
        res.redirect('/admin/channel-posts');
    } catch (error) {
        console.error('Error updating post:', error);
        req.session.error = 'Error updating post: ' + error.message;
        res.redirect('/admin/channel-posts');
    }
});

// Delete post
router.post('/channel-posts/delete', isAuthenticated, async (req, res) => {
    try {
        const { post_id } = req.body;
        
        // Delete post
        await ChannelPost.findByIdAndDelete(post_id);
        
        req.session.success = 'Post deleted successfully';
        res.redirect('/admin/channel-posts');
    } catch (error) {
        console.error('Error deleting post:', error);
        req.session.error = 'Error deleting post: ' + error.message;
        res.redirect('/admin/channel-posts');
    }
});

// Publish post to channel
router.post('/channel-posts/publish', isAuthenticated, async (req, res) => {
    try {
        const { post_id } = req.body;
        
        // Get post
        const post = await ChannelPost.findById(post_id);
        if (!post) {
            throw new Error('Post not found');
        }
        
        // Get bot instance from global scope
        const bot = global.bot;
        if (!bot) {
            throw new Error('Telegram bot not initialized');
        }
        
        // Get channel ID from settings
        const channelSetting = await Setting.findOne({ key: 'telegram_channel_id' });
        const channelId = channelSetting ? channelSetting.value : null;
        
        if (!channelId) {
            throw new Error('Telegram channel ID not configured in settings');
        }
        
        // Create inline keyboard if buttons exist
        let inlineKeyboard = undefined;
        if (post.buttons && post.buttons.length > 0) {
            console.log('Creating inline keyboard with buttons:', JSON.stringify(post.buttons));
            
            // Organize buttons into rows of 2 buttons each
            const rows = [];
            for (let i = 0; i < post.buttons.length; i += 2) {
                const row = [];
                
                // Add first button
                const button1 = post.buttons[i];
                if (button1) {
                    let btn1 = { text: button1.text };
                    
                    // Apply button type
                    switch (button1.type) {
                        case 'url':
                            btn1.url = button1.value;
                            break;
                        case 'bot':
                            // Remove @ from bot username if present
                            const botUsername = button1.value.startsWith('@') 
                                ? button1.value.substring(1) 
                                : button1.value;
                            btn1.url = `https://t.me/${botUsername}`;
                            break;
                        case 'support':
                            // Support links also go to Telegram
                            const supportUsername = button1.value.startsWith('@') 
                                ? button1.value.substring(1) 
                                : button1.value;
                            btn1.url = `https://t.me/${supportUsername}`;
                            break;
                        case 'webapp':
                            btn1.web_app = { url: button1.value };
                            break;
                    }
                    
                    row.push(btn1);
                }
                
                // Add second button if it exists
                const button2 = post.buttons[i + 1];
                if (button2) {
                    let btn2 = { text: button2.text };
                    
                    // Apply button type
                    switch (button2.type) {
                        case 'url':
                            btn2.url = button2.value;
                            break;
                        case 'bot':
                            // Remove @ from bot username if present
                            const botUsername = button2.value.startsWith('@') 
                                ? button2.value.substring(1) 
                                : button2.value;
                            btn2.url = `https://t.me/${botUsername}`;
                            break;
                        case 'support':
                            // Support links also go to Telegram
                            const supportUsername = button2.value.startsWith('@') 
                                ? button2.value.substring(1) 
                                : button2.value;
                            btn2.url = `https://t.me/${supportUsername}`;
                            break;
                        case 'webapp':
                            btn2.web_app = { url: button2.value };
                            break;
                    }
                    
                    row.push(btn2);
                }
                
                if (row.length > 0) {
                    rows.push(row);
                }
            }
            
            // Create the inline keyboard
            inlineKeyboard = {
                inline_keyboard: rows
            };
            
            console.log('Final inline keyboard:', JSON.stringify(inlineKeyboard));
        }
        
        // Configure message options
        const messageOptions = {
            parse_mode: 'HTML'
        };
        
        // Add inline keyboard if buttons exist
        if (inlineKeyboard) {
            messageOptions.reply_markup = inlineKeyboard;
        }
        
        // Send the message
        let messageResult;
        if (post.image_url) {
            // Send with image
            messageResult = await bot.sendPhoto(channelId, post.image_url, {
                caption: post.content,
                ...messageOptions
            });
        } else {
            // Send text only
            messageResult = await bot.sendMessage(channelId, post.content, messageOptions);
        }
        
        console.log('Message sent successfully:', messageResult ? messageResult.message_id : 'No message ID');
        
        // Update post status
        await ChannelPost.findByIdAndUpdate(post_id, {
            status: 'published',
            published_at: new Date(),
            updated_at: new Date()
        });
        
        req.session.success = 'Post published successfully to channel';
        res.redirect('/admin/channel-posts');
    } catch (error) {
        console.error('Error publishing post:', error);
        req.session.error = 'Error publishing post: ' + error.message;
        res.redirect('/admin/channel-posts');
    }
});

module.exports = router; 