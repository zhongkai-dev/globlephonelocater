const TelegramBot = require('node-telegram-bot-api');
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Configure session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// Configure view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'admin/layout');

// Parse request bodies
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database('./database/bot.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        // Initialize database schema
        const schema = require('fs').readFileSync('./database/schema.sql', 'utf8');
        db.exec(schema, (err) => {
            if (err) {
                console.error('Error initializing database schema:', err);
            } else {
                console.log('Database schema initialized');
            }
        });
    }
});

// Use environment variables for security
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERIPHONE_API_KEY = process.env.VERIPHONE_API_KEY;

if (!TELEGRAM_BOT_TOKEN || !VERIPHONE_API_KEY) {
    console.error("❌ Missing Telegram Bot Token or Veriphone API Key!");
    process.exit(1);
}

// Create the Telegram bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Function to get API key from database
async function getApiKey() {
    try {
        // Get all API keys
        const apiKeys = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM api_keys ORDER BY id ASC', [], (err, rows) => {
                if (err) {
                    console.error('Error getting API keys:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        if (apiKeys.length === 0) {
            console.warn('No API keys found, using default from settings');
            // Fall back to the one in settings
            const settingKey = await new Promise((resolve, reject) => {
                db.get('SELECT value FROM settings WHERE key = ?', ['veriphone_api_key'], (err, row) => {
                    if (err) reject(err);
                    resolve(row ? row.value : null);
                });
            });
            return settingKey || process.env.VERIPHONE_API_KEY;
        }

        // Get current API key index
        const currentIndexSetting = await new Promise((resolve, reject) => {
            db.get('SELECT value FROM settings WHERE key = ?', ['current_api_key_index'], (err, row) => {
                if (err) {
                    console.error('Error getting current API key index:', err);
                    reject(err);
                } else {
                    resolve(row || { value: '0' });
                }
            });
        });

        // Parse current index
        let currentIndex = parseInt(currentIndexSetting.value) || 0;
        
        // Get next key
        currentIndex = (currentIndex + 1) % apiKeys.length;
        
        // Update index in settings
        await new Promise((resolve, reject) => {
            db.run('UPDATE settings SET value = ? WHERE key = ?', [currentIndex.toString(), 'current_api_key_index'], (err) => {
                if (err) {
                    console.error('Error updating API key index:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        // Update usage count for this key
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE api_keys SET usage_count = usage_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?', 
                [apiKeys[currentIndex].id], 
                (err) => {
                    if (err) {
                        console.error('Error updating API key usage count:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });

        console.log(`Using API key ${currentIndex + 1}/${apiKeys.length}: ${apiKeys[currentIndex].value.substring(0, 8)}...`);
        return apiKeys[currentIndex].value;
    } catch (error) {
        console.error('Error in getApiKey:', error);
        return process.env.VERIPHONE_API_KEY;
    }
}

// Function to check bot status
async function getBotStatus() {
    try {
        const status = await new Promise((resolve, reject) => {
            db.get('SELECT value FROM settings WHERE key = ?', ['bot_status'], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.value : 'active');
            });
        });
        return status;
    } catch (error) {
        console.error('Error getting bot status:', error);
        return 'active'; // Default to active
    }
}

// Function to check if user is blocked
async function isUserBlocked(telegramId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT is_blocked FROM users WHERE telegram_id = ?', [telegramId], (err, row) => {
            if (err) {
                console.error('Error checking blocked status:', err);
                resolve(false); // Default to not blocked in case of error
            } else {
                console.log('Checking blocked status for user:', telegramId, 'Result:', row);
                resolve(row ? row.is_blocked === 1 : false);
            }
        });
    });
}

// Function to save user to database
async function saveUser(user) {
    return new Promise((resolve, reject) => {
        const params = [
            user.username || null,
            user.first_name || null,
            user.last_name || null,
            user.id.toString()
        ];
        
        console.log('Updating user:', params);
        
        // Use UPDATE or INSERT to preserve the is_blocked status
        db.run(
            `INSERT INTO users (telegram_id, username, first_name, last_name, is_blocked) 
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(telegram_id) 
             DO UPDATE SET 
                username = excluded.username,
                first_name = excluded.first_name,
                last_name = excluded.last_name
             WHERE telegram_id = excluded.telegram_id`,
            [user.id.toString(), user.username, user.first_name, user.last_name],
            (err) => {
                if (err) {
                    console.error('Error saving user:', err);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

// Function to save lookup history
async function saveHistory(userId, phoneNumber, data, isValid) {
    return new Promise((resolve, reject) => {
        // Check if lookup_history table exists
        db.run(`
            CREATE TABLE IF NOT EXISTS lookup_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                phone_number TEXT,
                country TEXT,
                region TEXT,
                carrier TEXT,
                carrier_type TEXT,
                is_valid INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(telegram_id)
            )
        `, (err) => {
            if (err) {
                console.error('Error creating lookup_history table:', err);
                return resolve();
            }
            
            // Get carrier information
            let carrier = '';
            let carrierType = '';
            if (data && data.carrier) {
                carrier = data.carrier;
                // Determine carrier type
                if (isSpecificCarrier(carrier, 'tmobile')) {
                    carrierType = 'tmobile';
                } else if (isSpecificCarrier(carrier, 'att')) {
                    carrierType = 'att';
                } else if (isSpecificCarrier(carrier, 'verizon')) {
                    carrierType = 'verizon';
                } else {
                    carrierType = 'other';
                }
            }
            
            // Insert lookup history
            const params = [
                userId,
                phoneNumber,
                data && data.country ? data.country : null,
                data && data.phone_region ? data.phone_region : null,
                carrier,
                carrierType,
                isValid ? 1 : 0
            ];
            
            db.run(
                'INSERT INTO lookup_history (user_id, phone_number, country, region, carrier, carrier_type, is_valid) VALUES (?, ?, ?, ?, ?, ?, ?)',
                params,
                (err) => {
                    if (err) {
                        console.error('Error saving lookup history:', err);
                    }
                    resolve();
                }
            );
        });
    });
}

// Function to check if provider is in a specific carrier group (like T-Mobile)
function isSpecificCarrier(carrierName, carrierType) {
    if (!carrierName) return false;
    
    const normalizedName = carrierName.toUpperCase();
    
    // T-Mobile carrier group check
    if (carrierType === 'tmobile') {
        const tmobileKeywords = [
            "T-MOBILE", "T MOBILE", "ELISKA WIRELESS VENTURES SUBSIDIARY I, LLC", "METROPCS", "METRO PCS", "SPRINT", 
            "BANDWIDTH.COM-NSR-10X/1", "METRO PCS COMMUNICATIONS INC-SVR-10X/2",
            "METRO PCS-ROYAL ST. COMM-SVR-10X/2", "OMNIPOINT COMMUNICATIONS CAP OPERATIONS, LLC",
            "OMNIPOINT COMMUNICATIONS ENTERPRISES, LP", "OMNIPOINT COMMUNICATIONS MIDWEST OPERATIONS, LLC",
            "OMNIPOINT COMMUNICATIONS, INC. - CT", "OMNIPOINT COMMUNICATIONS, INC. - NJ",
            "OMNIPOINT COMMUNICATIONS, INC. - NY", "OMNIPOINT MIAMI E LICENSE, LLC",
            "POWERTEL ATLANTA LICENSES, INC.", "POWERTEL BIRMINGHAM LICENSES, INC.",
            "POWERTEL JACKSONVILLE LICENSES, INC.", "POWERTEL KENTUCKY LICENSES, INC.",
            "POWERTEL MEMPHIS LICENSES, INC.", "POWERTEL NASHVILLE LICENSES, INC.",
            "T-MOBILE USA, INC.", "T-MOBILE US-SVR-10X/2", "Sprint PCS-SVR-10X/2"
        ];
        return tmobileKeywords.some(keyword => normalizedName.includes(keyword));
    }
    
    // AT&T carrier group check
    if (carrierType === 'att') {
        const attKeywords = [
            "AT&T", "ATT", "CINGULAR", "CRICKET"
        ];
        return attKeywords.some(keyword => normalizedName.includes(keyword));
    }
    
    // Verizon carrier group check
    if (carrierType === 'verizon') {
        const verizonKeywords = [
            "VERIZON", "CELLCO", "GTE", "ALLTEL"
        ];
        return verizonKeywords.some(keyword => normalizedName.includes(keyword));
    }
    
    return false;
}

// Function to check carrier using sent.dm API
async function checkCarrierWithSentDm(phoneNumber) {
    try {
        const response = await axios.get(`https://www.sent.dm/api/phone-lookup?phone=${phoneNumber}`);
        
        if (response.data && response.data.data && response.data.data.carrier) {
            const carrierData = response.data.data.carrier;
            const carrierName = carrierData.name || '';
            let carrierType = 'other';
            
            // Check for normalized carrier from sent.dm
            if (carrierData.normalized_carrier && carrierData.normalized_carrier.includes('T-Mobile')) {
                carrierType = 'tmobile';
            } else if (isSpecificCarrier(carrierName, 'tmobile')) {
                carrierType = 'tmobile';
            } else if (isSpecificCarrier(carrierName, 'att')) {
                carrierType = 'att';
            } else if (isSpecificCarrier(carrierName, 'verizon')) {
                carrierType = 'verizon';
            }
            
            // Format carrier display name
            let displayType = "Other-Mobile";
            if (carrierType === 'tmobile') {
                displayType = "T-Mobile";
            } else if (carrierType === 'att') {
                displayType = "AT&T";
            } else if (carrierType === 'verizon') {
                displayType = "Verizon";
            }
            
            return {
                name: carrierName,
                type: carrierType,
                displayType: displayType
            };
        }
        
        return null;
    } catch (error) {
        console.error("Error checking carrier with sent.dm:", error.message);
        return null;
    }
}

// Function to parse and format phone number details
async function getPhoneDetails(phoneNumberString, userId) {
    try {
        console.log("Received phone number:", phoneNumberString);

        // Parse phone number
        let phoneNumber;
        if (phoneNumberString.startsWith('+')) {
            phoneNumber = phoneUtil.parse(phoneNumberString);
        } else {
            phoneNumber = phoneUtil.parse(phoneNumberString, 'US');
        }

        if (!phoneUtil.isValidNumber(phoneNumber)) {
            console.log("Invalid phone number:", phoneNumberString);
            
            // Save invalid lookup to history
            await saveHistory(userId, phoneNumberString, null, false);
            
            return `📞Phone Number: ${phoneNumberString}\n❌ Invalid phone number.`;
        }

        // First try sent.dm API for carrier info
        const carrierInfo = await checkCarrierWithSentDm(phoneNumberString);
        
        // Get current API key from database
        const currentApiKey = await getApiKey();

        // Fetch details from Veriphone API
        try {
            const veriphoneResponse = await axios.get(
                `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(phoneNumberString)}&key=${currentApiKey}`
            );

            const data = veriphoneResponse.data;

            if (data.status === "success" && data.phone_valid) {
                // Use carrier info from sent.dm if available, otherwise fall back to Veriphone
                const carrierName = carrierInfo ? carrierInfo.name : (data.carrier || 'Unknown Carrier');
                const carrierType = carrierInfo ? carrierInfo.type : 'other';
                let displayCarrierType = carrierInfo ? carrierInfo.displayType : "Other-Mobile";
                
                if (!carrierInfo) {
                    // If sent.dm failed, use our fallback check
                    if (isSpecificCarrier(carrierName, 'tmobile')) {
                        displayCarrierType = "T-Mobile";
                    } else if (isSpecificCarrier(carrierName, 'att')) {
                        displayCarrierType = "AT&T";
                    } else if (isSpecificCarrier(carrierName, 'verizon')) {
                        displayCarrierType = "Verizon";
                    }
                }
                
                // Save valid lookup to history with carrier info
                await saveHistory(userId, phoneNumberString, {
                    ...data,
                    carrier: carrierName,
                    carrier_type: carrierType
                }, true);
                
                const country = data.country || "Unknown";
                const countryCode = data.country_code || "Unknown";
                const flagEmoji = String.fromCodePoint(...[...countryCode].map(c => 0x1F1E6 + c.toUpperCase().charCodeAt(0) - 65));

                return `📞Phone Number: ${data.e164 || phoneNumberString}
✅Status: Success
🌍Country: ${country} ${flagEmoji}
📍Region: ${data.phone_region || "N/A"}
📶<code>${carrierName}</code> (${displayCarrierType})`;
            } else {
                // Save invalid lookup to history
                await saveHistory(userId, phoneNumberString, data, false);
                
                return `📞Phone Number: ${phoneNumberString}\n❌ Phone number validation failed.`;
            }
        } catch (apiError) {
            // Save error lookup to history
            await saveHistory(userId, phoneNumberString, null, false);
            
            if (apiError.response && apiError.response.status === 401) {
                console.error("Unauthorized access to Veriphone API. Check your API key.");
                return `📞Phone Number: ${phoneNumberString}\n⚠️ Unauthorized access to Veriphone API. Please contact the bot administrator.`;
            } else {
                console.error("Error fetching details from Veriphone API:", apiError.message);
                return `📞Phone Number: ${phoneNumberString}\n⚠️ Error fetching additional details. Please try again later.`;
            }
        }
    } catch (error) {
        // Save error lookup to history
        if (userId) {
            await saveHistory(userId, phoneNumberString, null, false);
        }
        
        console.error("Error parsing phone number:", error.message);
        return `📞Phone Number: ${phoneNumberString}\n❌ Error parsing phone number. Please check the format.`;
    }
}

// Function to check and update user limits
async function checkUserLimit(userId, count = 1) {
    try {
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        
        // Get user's current limit info
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT check_limit, daily_checks, last_check_date FROM users WHERE telegram_id = ?', [userId], (err, row) => {
                if (err) {
                    console.error('Error getting user limit:', err);
                    reject(err);
                } else {
                    resolve(row || { check_limit: 10, daily_checks: 0, last_check_date: null });
                }
            });
        });
        
        // Check if it's a new day
        if (user.last_check_date !== today) {
            // Reset daily checks for new day
            await new Promise((resolve, reject) => {
                db.run('UPDATE users SET daily_checks = 0, last_check_date = ? WHERE telegram_id = ?', [today, userId], (err) => {
                    if (err) {
                        console.error('Error resetting daily checks:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            // Return updated limit info
            return { 
                limit: user.check_limit, 
                used: 0, 
                remaining: user.check_limit, 
                canCheck: count <= user.check_limit 
            };
        }
        
        // Check if user has reached or will exceed their daily limit
        if (user.daily_checks + count > user.check_limit) {
            console.log(`User ${userId} would exceed their daily limit of ${user.check_limit} checks`);
            return { 
                limit: user.check_limit, 
                used: user.daily_checks, 
                remaining: user.check_limit - user.daily_checks, 
                canCheck: false 
            };
        }
        
        // Increment daily checks by the count parameter
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET daily_checks = daily_checks + ?, last_check_date = ? WHERE telegram_id = ?', [count, today, userId], (err) => {
                if (err) {
                    console.error('Error updating daily checks:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        
        return { 
            limit: user.check_limit, 
            used: user.daily_checks + count, 
            remaining: user.check_limit - (user.daily_checks + count), 
            canCheck: true 
        };
    } catch (error) {
        console.error('Error in checkUserLimit:', error);
        // Default to allowing the check in case of error
        return { limit: 10, used: 0, remaining: 10, canCheck: true };
    }
}

// Handle incoming messages
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const inputText = msg.text.trim();
        const userId = msg.from.id.toString();

        console.log("Processing message from user:", userId);

        // Save user to database
        await saveUser(msg.from);

        // Check if user is blocked
        const blocked = await isUserBlocked(userId);
        console.log("User blocked status:", blocked);

        if (blocked) {
            console.log("Blocked user attempted to use bot:", userId);
            await bot.sendMessage(chatId, "⚠️ You have been blocked from using this bot. Please contact the administrator.", { parse_mode: 'HTML' });
            return;
        }

        // Check if bot is active
        const botStatus = await getBotStatus();
        if (botStatus !== 'active') {
            console.log("Bot is inactive, not processing message");
            await bot.sendMessage(chatId, "⚠️ Bot is currently offline for maintenance. Please try again later.", { parse_mode: 'HTML' });
            return;
        }

        if (inputText.startsWith('/')) {
            if (inputText === '/status') {
                // Check user limit status
                const limitInfo = await checkUserLimit(userId, 0); // Don't increment count for status checks
                await bot.sendMessage(chatId, `📊 <b>Your Usage Status</b>\n\n<b>Daily Limit:</b> ${limitInfo.limit} checks\n<b>Used Today:</b> ${limitInfo.used} checks\n<b>Remaining:</b> ${limitInfo.remaining} checks`, { parse_mode: 'HTML' });
                return;
            }
            
            await bot.sendMessage(chatId, "👋 Welcome! Please send one or more phone numbers (separated by line breaks) to locate. Use /status to check your daily usage.", { parse_mode: 'HTML' });
            return;
        }

        // Split the input text by line breaks to handle multiple phone numbers
        const phoneNumbers = inputText.split('\n').map(num => num.trim()).filter(num => num.length > 0);

        if (phoneNumbers.length === 0) {
            await bot.sendMessage(chatId, "⚠️ No valid phone numbers found. Please send one or more phone numbers separated by line breaks.", { parse_mode: 'HTML' });
            return;
        }

        // Check user limit before processing with the count of phone numbers
        const limitInfo = await checkUserLimit(userId, phoneNumbers.length);
        if (!limitInfo.canCheck) {
            await bot.sendMessage(chatId, `⚠️ <b>Daily Limit Reached</b>\n\nYou have reached your daily limit of ${limitInfo.limit} checks. Please try again tomorrow or send fewer numbers.`, { parse_mode: 'HTML' });
            return;
        }

        let responses = [];

        for (const phoneNumber of phoneNumbers) {
            const result = await getPhoneDetails(phoneNumber, userId);
            responses.push(result);
        }

        // Combine all responses into a single message
        const fullResponse = responses.join("\n\n") + 
            `\n📊 Daily Limit: ${limitInfo.used}/${limitInfo.limit} checks used` +
            "\n<blockquote>🤖Bot by <a href=\"https://t.me/ZhongKai_KL\">中凯</a></blockquote>";

        // Send the aggregated response back to the user
        await bot.sendMessage(chatId, fullResponse, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) {
        console.error("Error in message handler:", error);
        try {
            await bot.sendMessage(msg.chat.id, "⚠️ An error occurred while processing your request. Please try again later.", { parse_mode: 'HTML' });
        } catch (sendError) {
            console.error("Error sending error message:", sendError);
        }
    }
});

// Import and use admin routes
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// Root path handler
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Phone Locator Bot</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    text-align: center;
                    background-color: #f5f5f5;
                }
                .container {
                    max-width: 600px;
                    margin: 40px auto;
                    padding: 20px;
                    background: white;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                h1 { color: #333; }
                .telegram-button {
                    display: inline-block;
                    background-color: #0088cc;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 5px;
                    text-decoration: none;
                    margin-top: 20px;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📱 Phone Locator Bot</h1>
                <p>This bot helps you verify phone numbers and provides detailed carrier information.</p>
                <p>To use the bot, simply open Telegram and search for the bot.</p>
                <a href="https://t.me/YourBotUsername" class="telegram-button">Open in Telegram</a>
                <p style="margin-top: 30px; font-size: 0.8em; color: #666;">
                    Created by <a href="https://t.me/ZhongKai_KL">@ZhongKai_KL</a>
                </p>
            </div>
        </body>
        </html>
    `);
});

// Start the Express server
app.listen(port, () => {
    console.log(`✅ Admin panel is running on http://localhost:${port}`);
    console.log("✅ Telegram bot is running...");
});
