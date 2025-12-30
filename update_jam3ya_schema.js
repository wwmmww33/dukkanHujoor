const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

const updateSchemaSql = `
    CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`;

db.serialize(() => {
    // 1. Create Tables
    db.exec(updateSchemaSql, (err) => {
        if (err) {
            console.error('Error creating tables:', err.message);
            return;
        }
        console.log('Tables created successfully.');

        // 2. Populate Subjects from existing transactions
        db.all("SELECT DISTINCT subject FROM transactions WHERE subject IS NOT NULL", (err, rows) => {
            if (err) return console.error(err);
            const stmt = db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)");
            rows.forEach(row => {
                if(row.subject.trim() !== '') stmt.run(row.subject);
            });
            stmt.finalize(() => console.log('Subjects populated.'));
        });

        // 3. Populate Members from existing transactions (where subject = 'مساهمات الاعضاء')
        // We assume 'item' holds the member_code
        db.all("SELECT DISTINCT item FROM transactions WHERE subject = 'مساهمات الاعضاء'", (err, rows) => {
            if (err) return console.error(err);
            const stmt = db.prepare("INSERT OR IGNORE INTO members (member_code, name) VALUES (?, ?)");
            rows.forEach(row => {
                if(row.item && row.item.trim() !== '') {
                    // We don't have names yet, so we use code as placeholder or leave name empty?
                    // Schema says name is NOT NULL. So we use "Member [Code]" as placeholder.
                    stmt.run(row.item, `عضو ${row.item}`); 
                }
            });
            stmt.finalize(() => console.log('Members populated.'));
        });
    });
});
