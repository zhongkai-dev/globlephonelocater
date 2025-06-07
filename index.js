const TelegramBot = require('node-telegram-bot-api');
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');

// Try to load connect-flash but provide a fallback if not available
let flashMiddleware;
try {
    flashMiddleware = require('connect-flash');
    console.log('✅ connect-flash module loaded successfully');
} catch (e) {
    console.warn('⚠️ connect-flash module not found, using fallback implementation');
    // Simple fallback implementation
    flashMiddleware = function() {
        return function(req, res, next) {
            if (!req.session) {
                console.warn('Session not available for flash messages');
                req.flash = function() { return []; };
                req.flash.message = null;
                return next();
            }

            req.flash = function(type, message) {
                if (!req.session.flash) req.session.flash = {};
                if (!req.session.flash[type]) req.session.flash[type] = [];
                if (message) {
                    req.session.flash[type].push(message);
                } else {
                    const messages = req.session.flash[type] || [];
                    req.session.flash[type] = [];
                    return messages;
                }
            };
            next();
        };
    };
}

// Load environment variables from .env file if present
try {
    require('dotenv').config();
    console.log('✅ Environment variables loaded from .env file');
} catch (error) {
    console.log('ℹ️ No .env file found or error loading it, using system environment variables');
}

// Import MongoDB models
const { User, Setting, LookupHistory, ApiKey, initializeDatabase, Proxy } = require('./models');

// Initialize MongoDB database
initializeDatabase()
    .then(models => {
        // Store models for use throughout the application
        global.models = models;
        console.log("✅ Database initialized successfully");
    })
    .catch(err => console.error('❌ Error initializing MongoDB:', err));

// Initialize Express app
const app = express();

// Configure session
app.use(session({
    secret: process.env.SESSION_SECRET || 'phonelocator-secret-key',
    resave: false,
    saveUninitialized: true
}));

// Add flash middleware for proxy management
app.use(flashMiddleware());

// Configure view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'admin/layout');

// Parse request bodies
app.use(express.urlencoded({ extended: true }));

// Set PORT based on environment (Railway sets PORT by default)
const port = process.env.PORT || 3000;

// Log port information
console.log(`Server configured to run on port ${port}`);

// Use environment variables for security
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERIPHONE_API_KEY = process.env.VERIPHONE_API_KEY;

// Add a simple health check endpoint
app.get('/', (req, res) => {
    res.send('Phone Locator Bot Service is running');
});

// Create the Telegram bot with retry logic and error handling
let bot;
try {
    if (!TELEGRAM_BOT_TOKEN) {
        console.warn("⚠️ Missing Telegram Bot Token - bot functionality will be disabled");
    } else {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
            polling: true,
            // Add polling options to make it more robust
            polling_options: {
                timeout: 10,
                limit: 100
            }
        });
        
        // Add error handlers
        bot.on('polling_error', (error) => {
            console.error('Telegram polling error:', error.message);
        });
        
        bot.on('error', (error) => {
            console.error('Telegram bot error:', error.message);
        });
        
        console.log("✅ Telegram bot initialized successfully");
    }
} catch (error) {
    console.error("❌ Failed to initialize Telegram bot:", error.message);
    // Continue without the bot functionality
}

// Create a rate limiter for sent.dm API
const sentDmRateLimiter = {
    maxRequests: 15,  // 15 requests
    windowMs: 60000,  // per 60 seconds
    requests: [],     // timestamps of requests
    
    // Check if we can make a new request
    canMakeRequest() {
        const now = Date.now();
        // Remove requests older than windowMs
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        // Check if we have room for more requests
        return this.requests.length < this.maxRequests;
    },
    
    // Record a new request
    recordRequest() {
        this.requests.push(Date.now());
    },
    
    // Wait until we can make a request
    async waitForAvailableSlot() {
        // If we can make a request right now, no need to wait
        if (this.canMakeRequest()) {
            return;
        }
        
        // Calculate how long we need to wait
        const now = Date.now();
        const oldestRequest = this.requests[0];
        const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add 100ms buffer
        
        console.log(`Rate limit hit for sent.dm API. Waiting ${waitTime}ms before next request...`);
        
        // Wait for a slot to become available
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // After waiting, clean up old requests again
        return this.waitForAvailableSlot(); // Recursively check again
    }
};

// Add a memory cache for phone number checks
const phoneNumberCache = {
  cache: new Map(),
  maxSize: 10000, // Maximum number of items in cache
  ttl: 24 * 60 * 60 * 1000, // 24 hours TTL

  get(phoneNumber) {
    const item = this.cache.get(phoneNumber);
    if (!item) return null;
    
    // Check if item is expired
    if (Date.now() > item.expiry) {
      this.cache.delete(phoneNumber);
      return null;
    }
    
    return item.data;
  },
  
  set(phoneNumber, data) {
    // If cache is at max size, remove oldest entries
    if (this.cache.size >= this.maxSize) {
      const oldestEntries = [...this.cache.entries()]
        .sort((a, b) => a[1].expiry - b[1].expiry)
        .slice(0, Math.floor(this.maxSize * 0.1)); // Remove oldest 10%
      
      for (const [key] of oldestEntries) {
        this.cache.delete(key);
      }
    }
    
    this.cache.set(phoneNumber, {
      data,
      expiry: Date.now() + this.ttl,
    });
  }
};

// Proxy rotation system for sent.dm API
const proxySystem = {
  // You can add more proxies here in the format: { host: 'ip', port: port, auth: { username: 'user', password: 'pass' } }
  proxies: [
    null, // First option is direct connection (no proxy)
    // Add your proxies here
    // Example: { host: '123.456.789.0', port: 8080, auth: { username: 'proxyuser', password: 'proxypass' } }
  ],
  currentProxyIndex: 0,
  
  // Get next proxy in rotation
  getNextProxy() {
    if (this.proxies.length === 0) return null;
    
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
    return this.proxies[this.currentProxyIndex];
  },
  
  // Reset to direct connection
  resetProxy() {
    this.currentProxyIndex = 0;
    return this.proxies[0];
  },
  
  // Update proxies from database
  updateFromDatabase(dbProxies) {
    // Always keep the direct connection (null) as the first option
    const newProxies = [null];
    
    // Add all proxies from the database
    dbProxies.forEach(dbProxy => {
      const proxyConfig = {
        host: dbProxy.host,
        port: dbProxy.port
      };
      
      // Add auth if provided
      if (dbProxy.username && dbProxy.password) {
        proxyConfig.auth = {
          username: dbProxy.username,
          password: dbProxy.password
        };
      }
      
      newProxies.push(proxyConfig);
    });
    
    // Update the proxies array
    this.proxies = newProxies;
    console.log(`Updated proxy system with ${newProxies.length - 1} proxies from database`);
    
    // Reset index to start
    this.currentProxyIndex = 0;
  }
};

// Make the proxy system updateable from admin panel
global.updateProxies = (dbProxies) => {
  proxySystem.updateFromDatabase(dbProxies);
};

// Initialize proxies from database on startup
setTimeout(async () => {
  try {
    // Get active working proxies
    const activeProxies = await Proxy.find({ 
      is_active: 1,
      status: 'working'
    });
    
    if (activeProxies.length > 0) {
      console.log(`Found ${activeProxies.length} active proxies in database, initializing proxy system...`);
      proxySystem.updateFromDatabase(activeProxies);
    } else {
      console.log('No active proxies found in database');
    }
  } catch (error) {
    console.error('Error initializing proxies from database:', error);
  }
}, 3000); // Wait 3 seconds for database to initialize properly

// Function to get API key from database
async function getApiKey() {
    try {
        // Get all API keys
        const apiKeys = await ApiKey.find().sort({ id: 1 });

        if (apiKeys.length === 0) {
            console.warn('No API keys found, using default from settings');
            // Fall back to the one in settings
            const settingKey = await Setting.findOne({ key: 'veriphone_api_key' });
            return settingKey ? settingKey.value : process.env.VERIPHONE_API_KEY;
        }

        // Get current API key index
        const currentIndexSetting = await Setting.findOne({ key: 'current_api_key_index' }) || { value: '0' };

        // Parse current index
        let currentIndex = parseInt(currentIndexSetting.value) || 0;
        
        // Get next key
        currentIndex = (currentIndex + 1) % apiKeys.length;
        
        // Update index in settings
        await Setting.updateOne(
            { key: 'current_api_key_index' }, 
            { value: currentIndex.toString() }, 
            { upsert: true }
        );

        // Update usage count for this key
        await ApiKey.updateOne(
            { _id: apiKeys[currentIndex]._id }, 
            { 
                $inc: { usage_count: 1 },
                last_used: new Date()
            }
        );

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
        const status = await Setting.findOne({ key: 'bot_status' });
        return status ? status.value : 'active';
    } catch (error) {
        console.error('Error getting bot status:', error);
        return 'active'; // Default to active
    }
}

// Function to check if user is blocked
async function isUserBlocked(telegramId) {
    try {
        const user = await User.findOne({ telegram_id: telegramId });
        console.log('Checking blocked status for user:', telegramId, 'Result:', user);
        return user ? user.is_blocked === 1 : false;
    } catch (error) {
        console.error('Error checking blocked status:', error);
        return false; // Default to not blocked in case of error
    }
}

// Function to save user to database
async function saveUser(user) {
    try {
        console.log('Updating user:', user.id);
        
        // First check if user exists
        const existingUser = await User.findOne({ telegram_id: user.id.toString() });
        
        if (existingUser) {
            // Update existing user
            await User.findOneAndUpdate(
                { telegram_id: user.id.toString() },
                {
                    $set: {
                        username: user.username || existingUser.username,
                        first_name: user.first_name || existingUser.first_name,
                        last_name: user.last_name || existingUser.last_name
                    }
                }
            );
        } else {
            // Create new user
            await User.create({
                telegram_id: user.id.toString(),
                username: user.username || null,
                first_name: user.first_name || null,
                last_name: user.last_name || null,
                is_blocked: 0,
                check_limit: 1000,
                daily_checks: 0
            });
        }
    } catch (error) {
        console.error('Error saving user:', error);
        // Log the error but don't throw it to prevent message handler failures
        console.log('User data that caused error:', JSON.stringify(user));
    }
}

// Function to save lookup history
async function saveHistory(userId, phoneNumber, data, isValid) {
    try {
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
        await LookupHistory.create({
            user_id: userId,
            phone_number: phoneNumber,
            country: data && data.country ? data.country : null,
            region: data && data.phone_region ? data.phone_region : null,
            carrier: carrier,
            carrier_type: carrierType,
            is_valid: isValid ? 1 : 0
        });
    } catch (error) {
        console.error('Error saving lookup history:', error);
    }
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

// Function to check carrier using sent.dm API with rate limiting and proxy rotation
async function checkCarrierWithSentDm(phoneNumber) {
    // Try up to 3 times with different proxies if needed
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            // Wait until we can make a request without hitting rate limit
            await sentDmRateLimiter.waitForAvailableSlot();
            
            // Record this request
            sentDmRateLimiter.recordRequest();
            
            // Get current proxy configuration
            const proxy = proxySystem.getNextProxy();
            const axiosConfig = {};
            
            // If proxy is available, use it
            if (proxy) {
                console.log(`Using proxy #${proxySystem.currentProxyIndex} for sent.dm API call`);
                axiosConfig.proxy = proxy;
            }
            
            // Make the API call with proxy if configured
            const response = await axios.get(
                `https://www.sent.dm/api/phone-lookup?phone=${phoneNumber}`, 
                axiosConfig
            );
            
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
            console.error(`Error checking carrier with sent.dm (attempt ${attempt + 1}/3):`, error.message);
            
            // If we get a rate limit error (429), try another proxy
            if (error.response && error.response.status === 429) {
                console.log("Rate limit hit, rotating to next proxy");
                continue; 
            }
            
            // For other errors, just return null after all attempts
            if (attempt === 2) return null;
        }
    }
    
    return null;
}

// Function to process phone numbers in optimized batches
async function processBatchedPhoneNumbers(phoneNumbers, userId) {
    const results = new Array(phoneNumbers.length);
    
    // Set dynamic concurrency based on number of requests
    const MAX_CONCURRENCY = 10;
    const MIN_CONCURRENCY = 3;
    let concurrency = Math.min(
        MAX_CONCURRENCY, 
        Math.max(MIN_CONCURRENCY, Math.floor(phoneNumbers.length / 3))
    );
    
    console.log(`Processing ${phoneNumbers.length} phone numbers with concurrency of ${concurrency}`);
    
    // Process phone numbers with controlled concurrency
    let activePromises = 0;
    let nextIndex = 0;
    let completedCount = 0;
    
    // Create a promise that resolves when all phone numbers are processed
    return new Promise((resolveAll) => {
        // Function to start processing a phone number
        function processNext() {
            if (nextIndex >= phoneNumbers.length) {
                // No more phone numbers to process
                return;
            }
            
            const index = nextIndex++;
            const phoneNumber = phoneNumbers[index];
            
            activePromises++;
            
            getPhoneDetails(phoneNumber, userId)
                .then(result => {
                    results[index] = result;
                    completedCount++;
                })
                .catch(error => {
                    console.error(`Error processing phone number ${phoneNumber}:`, error);
                    results[index] = `📞Phone Number: ${phoneNumber}\n⚠️ Error processing this number.`;
                    completedCount++;
                })
                .finally(() => {
                    activePromises--;
                    
                    // Try to process another phone number
                    processNext();
                    
                    // If all phone numbers have been processed and no active promises, resolve
                    if (completedCount === phoneNumbers.length) {
                        resolveAll(results.filter(Boolean)); // Filter out any null/undefined results
                    }
                });
        }
        
        // Start initial batch of promises based on concurrency
        for (let i = 0; i < concurrency && i < phoneNumbers.length; i++) {
            processNext();
        }
        
        // Edge case: if phoneNumbers array is empty
        if (phoneNumbers.length === 0) {
            resolveAll([]);
        }
    });
}

// Function to get phone details with fallback options
async function getPhoneDetails(phoneNumberString, userId) {
    try {
        console.log("Received phone number:", phoneNumberString);

        // Check cache first
        const cachedResult = phoneNumberCache.get(phoneNumberString);
        if (cachedResult) {
            console.log("Cache hit for:", phoneNumberString);
            // Still save to history for tracking purposes
            await saveHistory(userId, phoneNumberString, cachedResult.data, cachedResult.isValid);
            return cachedResult.response;
        }

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
            
            const response = `📞Phone Number: ${phoneNumberString}\n❌ Invalid phone number.`;
            // Cache the result
            phoneNumberCache.set(phoneNumberString, { 
                data: null, 
                isValid: false,
                response: response
            });
            return response;
        }

        // Get current API key from database for Veriphone
        const currentApiKey = await getApiKey();
        
        // Try Veriphone first since it doesn't have rate limits
        let veriphoneResponse;
        try {
            veriphoneResponse = await axios.get(
                `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(phoneNumberString)}&key=${currentApiKey}`
            );
        } catch (error) {
            console.error("Error with Veriphone API:", error.message);
            veriphoneResponse = { data: null };
        }
        
        // Only call sent.dm if we need carrier info and Veriphone didn't provide it
        let carrierInfo = null;
        const data = veriphoneResponse.data;
        
        if (data && data.status === "success" && data.phone_valid) {
            // Only call sent.dm if Veriphone didn't provide carrier info
            if (!data.carrier || data.carrier === 'Unknown Carrier') {
                try {
                    carrierInfo = await checkCarrierWithSentDm(phoneNumberString);
                } catch (error) {
                    console.error("Error with sent.dm API:", error.message);
                }
            }
            
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
            const dataWithCarrier = {
                ...data,
                carrier: carrierName,
                carrier_type: carrierType
            };
            
            await saveHistory(userId, phoneNumberString, dataWithCarrier, true);
            
            const country = data.country || "Unknown";
            const countryCode = data.country_code || "Unknown";
            const flagEmoji = String.fromCodePoint(...[...countryCode].map(c => 0x1F1E6 + c.toUpperCase().charCodeAt(0) - 65));

            const response = `📞Phone Number: ${data.e164 || phoneNumberString}
✅Status: Success
🌍Country: ${country} ${flagEmoji}
📍Region: ${data.phone_region || "N/A"}
📶<code>${carrierName}</code> (${displayCarrierType})`;

            // Cache the result
            phoneNumberCache.set(phoneNumberString, { 
                data: dataWithCarrier, 
                isValid: true,
                response: response
            });
            
            return response;
        } else {
            // Save invalid lookup to history
            await saveHistory(userId, phoneNumberString, data, false);
            
            const response = `📞Phone Number: ${phoneNumberString}\n❌ Phone number validation failed.`;
            
            // Cache the result
            phoneNumberCache.set(phoneNumberString, { 
                data: data, 
                isValid: false,
                response: response
            });
            
            return response;
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
        // First ensure user has 1000 daily limit
        await User.updateOne(
            { telegram_id: userId, check_limit: { $ne: 1000 } },
            { $set: { check_limit: 1000 } }
        );
        
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        
        // Get user's current limit info
        const user = await User.findOne({ telegram_id: userId }) || { 
            check_limit: 1000, 
            daily_checks: 0, 
            last_check_date: null 
        };
        
        // Check if it's a new day
        if (user.last_check_date !== today) {
            // Reset daily checks for new day
            await User.updateOne(
                { telegram_id: userId },
                { 
                    $set: { 
                        daily_checks: 0,
                        last_check_date: today
                    }
                },
                { upsert: true }
            );
            
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
        await User.updateOne(
            { telegram_id: userId },
            { 
                $inc: { daily_checks: count },
                $set: { last_check_date: today }
            },
            { upsert: true }
        );
        
        return { 
            limit: user.check_limit, 
            used: user.daily_checks + count, 
            remaining: user.check_limit - (user.daily_checks + count), 
            canCheck: true 
        };
    } catch (error) {
        console.error('Error in checkUserLimit:', error);
        // Default to allowing the check in case of error
        return { limit: 1000, used: 0, remaining: 1000, canCheck: true };
    }
}

// Function to edit message with loading indicator
async function editMessageWithLoadingIndicator(chatId, messageId, currentNumber = 1, totalNumbers = 1, maxDots = 5) {
    let dots = 0;
    let isRunning = true;
    let lastText = "";
    
    const timer = setInterval(async () => {
        if (!isRunning) {
            clearInterval(timer);
            return;
        }
        
        dots = (dots % maxDots) + 1;
        
        // Create the loading message with appropriate number of dots and progress counter
        let loadingText = `${currentNumber}/${totalNumbers} Number is Checking`;
        for (let i = 0; i < dots; i++) {
            loadingText += " ․";
        }
        
        // Don't update if the message hasn't changed
        if (loadingText === lastText) {
            return;
        }
        
        lastText = loadingText;
        
        try {
            await bot.editMessageText(loadingText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            });
        } catch (error) {
            // If the error is because message is not modified, continue
            if (error.message && error.message.includes("message is not modified")) {
                console.log("Message is identical, continuing animation...");
                // Don't stop the timer, just continue
            } else {
                // Stop for other errors
                console.error("Error editing loading message:", error.message);
                isRunning = false;
                clearInterval(timer);
            }
        }
    }, 300); // 300ms interval
    
    // Return an object with timer and stop function
    return {
        timer,
        stop: () => {
            isRunning = false;
            clearInterval(timer);
        },
        updateProgress: (current) => {
            currentNumber = current;
        }
    };
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
                // Ensure user has 1000 daily limit
                await User.updateOne(
                    { telegram_id: userId, check_limit: { $ne: 1000 } },
                    { $set: { check_limit: 1000 } },
                    { upsert: true }
                );
                
                // Check user limit status
                const limitInfo = await checkUserLimit(userId, 0); // Don't increment count for status checks
                await bot.sendMessage(chatId, `📊 <b>Your Usage Status</b>\n\n<b>Daily Limit:</b> ${limitInfo.limit} checks\n<b>Used Today:</b> ${limitInfo.used} checks\n<b>Remaining:</b> ${limitInfo.remaining} checks`, { parse_mode: 'HTML' });
                return;
            }
            
            // Special admin command to reset all users to 1000 limit
            if (inputText === '/resetalllimits' && (userId === '123456789' || userId === '5651879548')) { // Replace with actual admin IDs
                await User.updateMany(
                    {},
                    { $set: { check_limit: 1000, daily_checks: 0 } }
                );
                
                await bot.sendMessage(chatId, "✅ All users have been reset to 1000 daily limit and their daily counts have been reset to 0.", { parse_mode: 'HTML' });
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
        
        // Limit to maximum 30 numbers per request
        if (phoneNumbers.length > 30) {
            await bot.sendMessage(chatId, "⚠️ <b>Too Many Numbers</b>\n\nYou can check a maximum of 30 phone numbers in a single request. Please send fewer numbers.", { parse_mode: 'HTML' });
            return;
        }

        // Check user limit before processing with the count of phone numbers
        const limitInfo = await checkUserLimit(userId, phoneNumbers.length);
        if (!limitInfo.canCheck) {
            await bot.sendMessage(chatId, `⚠️ <b>Daily Limit Reached</b>\n\nYou have reached your daily limit of ${limitInfo.limit} checks. Please try again tomorrow or send fewer numbers.`, { parse_mode: 'HTML' });
            return;
        }

        // Send initial loading message and get its ID for updates
        const totalPhoneNumbers = phoneNumbers.length;
        const loadingMessage = await bot.sendMessage(chatId, `Processing ${totalPhoneNumbers} numbers in optimized batches...`, { parse_mode: 'HTML' });
        const loadingIndicator = await editMessageWithLoadingIndicator(chatId, loadingMessage.message_id, 1, totalPhoneNumbers);
        
        // Process phone numbers in batches with rate limiting
        let completedCount = 0;
        const updateProgressInterval = setInterval(() => {
            // Update the progress less frequently to avoid Telegram API rate limits
            loadingIndicator.updateProgress(completedCount);
        }, 2000);
        
        // Process in optimized batches
        const responses = await processBatchedPhoneNumbers(phoneNumbers, userId);
        completedCount = responses.length;
        
        // Clear update interval
        clearInterval(updateProgressInterval);
        
        // Stop the loading indicator
        loadingIndicator.stop();
        
        // Combine all responses into a single message
        const fullResponse = responses.join("\n\n") + 
            `\n📊 Daily Limit: ${limitInfo.used}/${limitInfo.limit} checks used` +
            "\n<blockquote>🤖Bot by <a href=\"https://t.me/ZhongKai_KL\">中凯</a></blockquote>";

        // Edit the loading message with the final response
        await bot.editMessageText(fullResponse, {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
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

// Set up static file serving
app.use(express.static(path.join(__dirname, 'public')));

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
