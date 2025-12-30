const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const migrations = [
    "ALTER TABLE products ADD COLUMN product_condition TEXT DEFAULT 'used'",
    "ALTER TABLE products ADD COLUMN youtube_link TEXT"
];

migrations.forEach(sql => {
    db.run(sql, (err) => {
        if (err) console.log('Migration info:', err.message);
        else console.log('Migration success:', sql);
    });
});

db.close();
