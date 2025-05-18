/**
 * Database compatibility layer
 * Gracefully handles SQLite3 dependency in different environments
 */

let sqlite3 = null;
let db = null;

// Try to load SQLite3, but don't crash if it's not available
try {
    sqlite3 = require('sqlite3');
    console.log('SQLite3 loaded successfully for compatibility with legacy scripts');
    
    // Create a dummy database connection for legacy scripts
    try {
        db = new sqlite3.Database('./database/bot.db');
        console.log('Connected to SQLite database for legacy compatibility');
    } catch (dbError) {
        console.warn('Failed to connect to SQLite database:', dbError.message);
        // Create a mock DB object with empty methods
        db = {
            all: (sql, params, callback) => callback(null, []),
            get: (sql, params, callback) => callback(null, null),
            run: (sql, params, callback) => callback(null),
            close: () => {}
        };
    }
} catch (error) {
    console.log('SQLite3 not available, using MongoDB only');
    
    // Create mock objects for compatibility
    sqlite3 = {
        verbose: () => ({
            Database: class MockDatabase {
                constructor() {
                    return {
                        all: (sql, params, callback) => callback(null, []),
                        get: (sql, params, callback) => callback(null, null),
                        run: (sql, params, callback) => callback(null),
                        close: () => {}
                    };
                }
            }
        })
    };
    
    // Create a mock DB object with empty methods
    db = {
        all: (sql, params, callback) => callback(null, []),
        get: (sql, params, callback) => callback(null, null),
        run: (sql, params, callback) => callback(null),
        close: () => {}
    };
}

module.exports = { sqlite3, db }; 