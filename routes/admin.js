const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/bot.db');
const path = require('path');
const ejs = require('ejs');

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
        
        // Get recent lookups
        const recentLookups = await new Promise((resolve, reject) => {
            db.all(`
                SELECT lh.*, u.username 
                FROM lookup_history lh 
                LEFT JOIN users u ON lh.user_id = u.telegram_id 
                ORDER BY lh.created_at DESC LIMIT 10
            `, [], (err, rows) => {
                if (err) reject(err);
                resolve(rows || []);
            });
        });
        
        // Get active API key
        const apiKey = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM settings WHERE key = ?', ['veriphone_api_key'], (err, row) => {
                if (err) reject(err);
                resolve(row || { value: '', updated_at: new Date() });
            });
        });
        
        // Get bot status
        const botStatus = await new Promise((resolve, reject) => {
            db.get('SELECT value FROM settings WHERE key = ?', ['bot_status'], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.value : 'active');
            });
        });
        
        res.render('admin/dashboard', {
            title: 'Dashboard',
            activePage: 'dashboard',
            stats,
            recentLookups,
            apiKey: apiKey.value,
            botStatus
        });
    } catch (error) {
        console.error('Error rendering dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

// Users management
router.get('/users', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const search = req.query.q || '';
        
        // Get total users count
        const totalCount = await new Promise((resolve, reject) => {
            let query = 'SELECT COUNT(*) as count FROM users';
            let params = [];
            
            if (search) {
                query += ' WHERE username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR telegram_id LIKE ?';
                const searchParam = `%${search}%`;
                params = [searchParam, searchParam, searchParam, searchParam];
            }
            
            db.get(query, params, (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get users with lookup count
        const users = await new Promise((resolve, reject) => {
            let query = `
                SELECT u.*, COUNT(lh.id) as lookup_count 
                FROM users u 
                LEFT JOIN lookup_history lh ON u.telegram_id = lh.user_id
            `;
            
            let params = [];
            if (search) {
                query += ' WHERE username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR telegram_id LIKE ?';
                const searchParam = `%${search}%`;
                params = [searchParam, searchParam, searchParam, searchParam];
            }
            
            query += ' GROUP BY u.telegram_id ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                resolve(rows || []);
            });
        });
        
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
            search
        });
    } catch (error) {
        console.error('Error rendering users page:', error);
        res.status(500).send('Error loading users');
    }
});

// User details
router.get('/users/:id', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Get user
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                if (!row) reject(new Error('User not found'));
                resolve(row);
            });
        });
        
        // Get user stats
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as totalLookups,
                    SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) as validLookups,
                    SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) as invalidLookups
                FROM lookup_history 
                WHERE user_id = ?
            `, [userId], (err, row) => {
                if (err) reject(err);
                resolve(row || { totalLookups: 0, validLookups: 0, invalidLookups: 0 });
            });
        });
        
        // Get recent lookup history
        const lookupHistory = await new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM lookup_history 
                WHERE user_id = ? 
                ORDER BY created_at DESC LIMIT 10
            `, [userId], (err, rows) => {
                if (err) reject(err);
                resolve(rows || []);
            });
        });
        
        res.render('admin/user-detail', {
            title: 'User Details',
            activePage: 'users',
            user,
            stats,
            lookupHistory
        });
    } catch (error) {
        console.error('Error rendering user details:', error);
        res.status(500).send('Error loading user details');
    }
});

// Update user check limit
router.post('/users/:id/update-limit', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        const { check_limit } = req.body;
        
        // Validate
        const limit = parseInt(check_limit);
        if (isNaN(limit) || limit < 0) {
            return res.status(400).send('Invalid check limit value');
        }
        
        // Update user check limit
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET check_limit = ? WHERE telegram_id = ?', [limit, userId], function(err) {
                if (err) {
                    console.error('Error updating user check limit:', err);
                    reject(err);
                }
                resolve(this.changes);
            });
        });
        
        // Redirect back to user detail page
        res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        console.error('Error updating user check limit:', error);
        res.status(500).send('Error updating user check limit');
    }
});

// Reset user daily checks
router.post('/users/:id/reset-checks', isAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Reset daily checks
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET daily_checks = 0, last_check_date = NULL WHERE telegram_id = ?', [userId], function(err) {
                if (err) {
                    console.error('Error resetting daily checks:', err);
                    reject(err);
                }
                resolve(this.changes);
            });
        });
        
        // Redirect back to user detail page
        res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        console.error('Error resetting daily checks:', error);
        res.status(500).send('Error resetting daily checks');
    }
});

// API Keys management
router.get('/api-keys', isAuthenticated, async (req, res) => {
    try {
        // Get flash messages from session and clear them
        const flashError = req.session.flashError;
        const flashSuccess = req.session.flashSuccess;
        const flashInfo = req.session.flashInfo;
        
        // Clear flash messages
        delete req.session.flashError;
        delete req.session.flashSuccess;
        delete req.session.flashInfo;
        
        // Get active API key
        const activeApiKey = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM settings WHERE key = ?', ['veriphone_api_key'], (err, row) => {
                if (err) reject(err);
                resolve(row || { value: '', updated_at: new Date() });
            });
        });
        
        // Make sure the api_keys table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS api_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    value TEXT UNIQUE,
                    is_active INTEGER DEFAULT 0,
                    usage_count INTEGER DEFAULT 0,
                    last_used DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        // Get all API keys
        const apiKeys = await new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM api_keys 
                ORDER BY usage_count DESC, created_at DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                resolve(rows || []);
            });
        });
        
        // Add the active API key if it's not in the list
        let activeKeyExists = false;
        for (const key of apiKeys) {
            if (key.value === activeApiKey.value) {
                activeKeyExists = true;
                break;
            }
        }
        
        if (!activeKeyExists && activeApiKey.value) {
            apiKeys.unshift({
                id: 0,
                value: activeApiKey.value,
                created_at: activeApiKey.updated_at,
                usage_count: 0,
                is_active: 1
            });
        }
        
        res.render('admin/api-keys', {
            title: 'API Key Management',
            activePage: 'api-keys',
            activeApiKey,
            apiKeys,
            flashError,
            flashSuccess,
            flashInfo
        });
    } catch (error) {
        console.error('Error rendering API keys page:', error);
        res.status(500).send('Error loading API keys: ' + error.message);
    }
});

// Add API key
router.post('/add-api-key', isAuthenticated, async (req, res) => {
    try {
        const { apiKey, setAsActive } = req.body;
        
        // Validate API key length
        if (!apiKey || apiKey.length < 30) {
            req.session.flashError = 'API key must be at least 30 characters long';
            return res.redirect('/admin/api-keys');
        }
        
        // Check if api_keys table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS api_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    value TEXT UNIQUE,
                    is_active INTEGER DEFAULT 0,
                    usage_count INTEGER DEFAULT 0,
                    last_used DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        // Insert new API key
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO api_keys (value) VALUES (?)', [apiKey], (err) => {
                if (err && err.message.includes('UNIQUE constraint failed')) {
                    // Key already exists, that's fine
                    req.session.flashInfo = 'API key already exists in the database';
                    resolve();
                } else if (err) {
                    reject(err);
                } else {
                    req.session.flashSuccess = 'API key added successfully';
                    resolve();
                }
            });
        });
        
        // Set as active if requested
        if (setAsActive) {
            await new Promise((resolve, reject) => {
                db.run('UPDATE settings SET value = ? WHERE key = ?', [apiKey, 'veriphone_api_key'], (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        }
        
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error adding API key:', error);
        req.session.flashError = 'Error adding API key: ' + error.message;
        res.redirect('/admin/api-keys');
    }
});

// Delete API key
router.post('/delete-api-key/:id', isAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        
        // Delete the API key
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM api_keys WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.status(500).send('Error deleting API key');
    }
});

// Update API key
router.post('/update-api-key', isAuthenticated, async (req, res) => {
    try {
        const { apiKey } = req.body;
        
        // Update the active API key
        await new Promise((resolve, reject) => {
            db.run('UPDATE settings SET value = ? WHERE key = ?', [apiKey, 'veriphone_api_key'], (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        res.redirect('/admin/api-keys');
    } catch (error) {
        console.error('Error updating API key:', error);
        res.status(500).send('Error updating API key');
    }
});

// History page
router.get('/history', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        // Get filters
        const user = req.query.user || null;
        const from = req.query.from || null;
        const to = req.query.to || null;
        const carrier_type = req.query.carrier_type || null;
        
        let query = `
            SELECT lh.*, u.username 
            FROM lookup_history lh 
            LEFT JOIN users u ON lh.user_id = u.telegram_id 
            WHERE 1=1
        `;
        
        let countQuery = `
            SELECT COUNT(*) as count 
            FROM lookup_history lh 
            WHERE 1=1
        `;
        
        let params = [];
        let countParams = [];
        let queryString = '';
        
        if (user) {
            query += ' AND lh.user_id = ?';
            countQuery += ' AND user_id = ?';
            params.push(user);
            countParams.push(user);
            queryString += `&user=${user}`;
        }
        
        if (from) {
            query += ' AND DATE(lh.created_at) >= DATE(?)';
            countQuery += ' AND DATE(created_at) >= DATE(?)';
            params.push(from);
            countParams.push(from);
            queryString += `&from=${from}`;
        }
        
        if (to) {
            query += ' AND DATE(lh.created_at) <= DATE(?)';
            countQuery += ' AND DATE(created_at) <= DATE(?)';
            params.push(to);
            countParams.push(to);
            queryString += `&to=${to}`;
        }
        
        if (carrier_type) {
            query += ' AND lh.carrier_type = ?';
            countQuery += ' AND carrier_type = ?';
            params.push(carrier_type);
            countParams.push(carrier_type);
            queryString += `&carrier_type=${carrier_type}`;
        }
        
        query += ' ORDER BY lh.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        // Get history count
        const totalCount = await new Promise((resolve, reject) => {
            db.get(countQuery, countParams, (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get history
        const history = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) {
                    // If table doesn't exist yet, return empty array
                    if (err.message.includes('no such table')) {
                        return resolve([]);
                    }
                    reject(err);
                }
                resolve(rows || []);
            });
        });
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.render('admin/history', {
            title: 'Lookup History',
            activePage: 'history',
            history,
            pagination: {
                currentPage: page,
                totalPages,
                totalCount
            },
            filters: {
                user,
                from: from || '',
                to: to || '',
                carrier_type,
                queryString
            }
        });
    } catch (error) {
        console.error('Error rendering history page:', error);
        res.status(500).send('Error loading history');
    }
});

// Toggle user block status
router.post('/toggle-user/:telegramId', isAuthenticated, async (req, res) => {
    const { telegramId } = req.params;
    
    try {
        // First get current status
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT is_blocked FROM users WHERE telegram_id = ?', [telegramId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (!user) {
            console.error(`User ${telegramId} not found`);
            return res.status(404).send('User not found');
        }

        const newBlockedStatus = user.is_blocked === 0 ? 1 : 0;
        console.log(`Toggling user ${telegramId} blocked status from ${user.is_blocked} to ${newBlockedStatus}`);

        // Update the blocked status
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE users SET is_blocked = ? WHERE telegram_id = ?',
                [newBlockedStatus, telegramId],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        console.log(`Successfully updated user ${telegramId} blocked status to ${newBlockedStatus}`);
        
        // Redirect back to referrer or users page
        const referrer = req.get('Referrer');
        if (referrer && referrer.includes('/admin/users/')) {
            res.redirect(`/admin/users/${telegramId}`);
        } else {
            res.redirect('/admin/users');
        }
    } catch (error) {
        console.error('Error in toggle-user:', error);
        res.status(500).send('Database error');
    }
});

// Export history to CSV
router.get('/history/export', isAuthenticated, async (req, res) => {
    try {
        // Get all history
        const history = await new Promise((resolve, reject) => {
            db.all(`
                SELECT lh.*, u.username 
                FROM lookup_history lh 
                LEFT JOIN users u ON lh.user_id = u.telegram_id 
                ORDER BY lh.created_at DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                resolve(rows || []);
            });
        });
        
        // Create CSV data
        let csv = 'ID,User ID,Username,Phone Number,Country,Region,Carrier,Carrier Type,Valid,Date\n';
        
        history.forEach(entry => {
            csv += `${entry.id},${entry.user_id},"${entry.username || ''}","${entry.phone_number}","${entry.country || ''}","${entry.region || ''}","${entry.carrier || ''}","${entry.carrier_type || ''}",${entry.is_valid ? 'Yes' : 'No'},"${new Date(entry.created_at).toLocaleString()}"\n`;
        });
        
        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=lookup_history_${new Date().toISOString().slice(0, 10)}.csv`);
        
        res.send(csv);
    } catch (error) {
        console.error('Error exporting history:', error);
        res.status(500).send('Error exporting history');
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Bot control routes
router.post('/bot/start', isAuthenticated, async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            db.run('UPDATE settings SET value = ? WHERE key = ?', ['active', 'bot_status'], (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        console.log('Bot set to active by admin');
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error starting bot:', error);
        res.status(500).send('Error starting bot');
    }
});

router.post('/bot/stop', isAuthenticated, async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            db.run('UPDATE settings SET value = ? WHERE key = ?', ['inactive', 'bot_status'], (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        console.log('Bot set to inactive by admin');
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error stopping bot:', error);
        res.status(500).send('Error stopping bot');
    }
});

// Helper function to get dashboard stats
async function getStats() {
    try {
        // Get user count
        const userCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get blocked user count
        const blockedUserCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM users WHERE is_blocked = 1', [], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get lookup count
        const lookupCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM lookup_history', [], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get valid lookup count
        const validLookupCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM lookup_history WHERE is_valid = 1', [], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get invalid lookup count
        const invalidLookupCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM lookup_history WHERE is_valid = 0', [], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });
        
        // Get API key count
        const apiKeyCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM api_keys', [], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.count : 0);
            });
        });

        // Get carrier counts
        let tmobileCount = 0;
        let attCount = 0;
        let verizonCount = 0;
        let otherCarrierCount = 0;
        
        try {
            tmobileCount = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM lookup_history WHERE carrier_type = ?', ['tmobile'], (err, row) => {
                    if (err) resolve(0);
                    else resolve(row ? row.count : 0);
                });
            });
            
            attCount = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM lookup_history WHERE carrier_type = ?', ['att'], (err, row) => {
                    if (err) resolve(0);
                    else resolve(row ? row.count : 0);
                });
            });
            
            verizonCount = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM lookup_history WHERE carrier_type = ?', ['verizon'], (err, row) => {
                    if (err) resolve(0);
                    else resolve(row ? row.count : 0);
                });
            });
            
            otherCarrierCount = await new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM lookup_history WHERE carrier_type = ? OR carrier_type IS NULL OR carrier_type = ""', ['other'], (err, row) => {
                    if (err) resolve(0);
                    else resolve(row ? row.count : 0);
                });
            });
        } catch (error) {
            console.warn('Error getting carrier counts:', error);
        }

        // Get today's check count - with error handling for missing columns
        const today = new Date().toISOString().split('T')[0];
        let todayChecks = 0;
        try {
            todayChecks = await new Promise((resolve, reject) => {
                db.get(`SELECT SUM(daily_checks) as count FROM users WHERE last_check_date = ?`, [today], (err, row) => {
                    if (err) {
                        console.warn('Error getting today checks, using 0:', err.message);
                        resolve(0);
                    } else {
                        resolve(row && row.count ? row.count : 0);
                    }
                });
            });
        } catch (error) {
            console.warn('Failed to get today checks, using 0:', error.message);
        }
        
        // Get users at limit count - with error handling for missing columns
        let usersAtLimit = 0;
        try {
            usersAtLimit = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as count FROM users WHERE daily_checks >= check_limit AND last_check_date = ?`, [today], (err, row) => {
                    if (err) {
                        console.warn('Error getting users at limit, using 0:', err.message);
                        resolve(0);
                    } else {
                        resolve(row ? row.count : 0);
                    }
                });
            });
        } catch (error) {
            console.warn('Failed to get users at limit, using 0:', error.message);
        }
        
        // Average checks per user
        const avgChecksPerUser = lookupCount > 0 && userCount > 0 ? (lookupCount / userCount).toFixed(2) : 0;
        
        return {
            userCount,
            blockedUserCount,
            lookupCount,
            validLookupCount,
            invalidLookupCount,
            apiKeyCount,
            avgChecksPerUser,
            todayChecks,
            usersAtLimit,
            carrierStats: {
                tmobileCount,
                attCount,
                verizonCount,
                otherCarrierCount
            }
        };
    } catch (error) {
        console.error('Error getting stats:', error);
        // Return default values to prevent the dashboard from crashing
        return {
            userCount: 0,
            blockedUserCount: 0,
            lookupCount: 0,
            validLookupCount: 0,
            invalidLookupCount: 0,
            apiKeyCount: 0,
            avgChecksPerUser: 0,
            todayChecks: 0,
            usersAtLimit: 0,
            carrierStats: {
                tmobileCount: 0,
                attCount: 0,
                verizonCount: 0,
                otherCarrierCount: 0
            }
        };
    }
}

// Helper function to render a view
async function renderView(viewPath, data = {}) {
    // Provide default values for title and activePage
    const viewData = {
        title: 'Admin Panel',
        activePage: '',
        ...data
    };
    
    return new Promise((resolve, reject) => {
        ejs.renderFile(path.join(__dirname, '..', 'views', `${viewPath}.ejs`), viewData, (err, html) => {
            if (err) reject(err);
            resolve(html);
        });
    });
}

module.exports = router; 