const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("PRAGMA table_info(members)", (err, columns) => {
        if (err) {
            console.error("Error getting table info:", err);
            return;
        }

        const hasIsActive = columns.some(col => col.name === 'is_active');
        const hasNotes = columns.some(col => col.name === 'notes');

        db.run("BEGIN TRANSACTION");

        if (!hasIsActive) {
            console.log("Adding is_active column...");
            // Default 1 (Active)
            db.run("ALTER TABLE members ADD COLUMN is_active INTEGER DEFAULT 1");
        }

        if (!hasNotes) {
            console.log("Adding notes column...");
            db.run("ALTER TABLE members ADD COLUMN notes TEXT");
        }

        db.run("COMMIT", (err) => {
            if (err) console.error("Error committing:", err);
            else console.log("Columns added successfully.");
            db.close();
        });
    });
});
