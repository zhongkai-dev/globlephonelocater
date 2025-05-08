const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/bot.db');

console.log('Starting database migration for carrier information...');

// Run migrations
db.serialize(() => {
    // Add carrier columns to lookup_history table
    db.run(`ALTER TABLE lookup_history ADD COLUMN carrier TEXT`, (err) => {
        if (err) {
            if (err.message.includes('duplicate column')) {
                console.log('Column carrier already exists');
            } else {
                console.error('Error adding carrier column:', err);
            }
        } else {
            console.log('Added carrier column to lookup_history table');
        }
    });

    db.run(`ALTER TABLE lookup_history ADD COLUMN carrier_type TEXT`, (err) => {
        if (err) {
            if (err.message.includes('duplicate column')) {
                console.log('Column carrier_type already exists');
            } else {
                console.error('Error adding carrier_type column:', err);
            }
        } else {
            console.log('Added carrier_type column to lookup_history table');
        }
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