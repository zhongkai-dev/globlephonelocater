const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/bot.db');

console.log('Starting database migration...');

// Run migrations
db.serialize(() => {
    // Check if columns exist in users table
    db.get("PRAGMA table_info(users)", (err, rows) => {
        if (err) {
            console.error('Error checking table structure:', err);
            return;
        }

        // Add missing columns to users table
        db.run(`ALTER TABLE users ADD COLUMN check_limit INTEGER DEFAULT 10`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column')) {
                    console.log('Column check_limit already exists');
                } else {
                    console.error('Error adding check_limit column:', err);
                }
            } else {
                console.log('Added check_limit column to users table');
            }
        });

        db.run(`ALTER TABLE users ADD COLUMN daily_checks INTEGER DEFAULT 0`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column')) {
                    console.log('Column daily_checks already exists');
                } else {
                    console.error('Error adding daily_checks column:', err);
                }
            } else {
                console.log('Added daily_checks column to users table');
            }
        });

        db.run(`ALTER TABLE users ADD COLUMN last_check_date DATE`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column')) {
                    console.log('Column last_check_date already exists');
                } else {
                    console.error('Error adding last_check_date column:', err);
                }
            } else {
                console.log('Added last_check_date column to users table');
            }
        });
    });
});

// Close the database connection after migrations
setTimeout(() => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Migration completed. Database connection closed.');
        }
    });
}, 1000); 