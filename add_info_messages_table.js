const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

console.log(`Connecting to database: ${dbPath}`);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS info_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        display_until DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error("Error creating info_messages table:", err);
        } else {
            console.log("info_messages table created successfully.");
        }
    });
});

db.close();
