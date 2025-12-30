const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

const createTablesSql = `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATETIME,
        subject TEXT,
        item TEXT,
        details TEXT,
        amount DECIMAL(10, 2),
        balance DECIMAL(10, 2),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`;

db.serialize(() => {
    db.exec(createTablesSql, (err) => {
        if (err) {
            console.error('Error creating tables:', err.message);
        } else {
            console.log('Database and tables created successfully.');
        }
        db.close();
    });
});
