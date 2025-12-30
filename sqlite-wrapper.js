const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class SQLitePool {
    constructor(config) {
        this.dbPath = path.join(__dirname, 'database.sqlite');
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) console.error('Could not connect to SQLite database:', err);
            else console.log('Connected to SQLite database');
        });
        
        // Initialize promise
        this.ready = this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            const initSql = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                phone TEXT UNIQUE,
                password TEXT NOT NULL,
                email TEXT,
                bio TEXT,
                avatar TEXT,
                is_admin INTEGER DEFAULT 0,
                is_main_store INTEGER DEFAULT 0,
                is_suspended INTEGER DEFAULT 0,
                suspension_reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                reset_password_token TEXT,
                reset_password_expires DATETIME
            );

            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL,
                category_id INTEGER,
                image_path TEXT,
                status TEXT DEFAULT 'available',
                admin_hidden INTEGER DEFAULT 0,
                admin_hide_reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(category_id) REFERENCES categories(id)
            );
            `;

            this.db.serialize(() => {
                // 1. Create tables
                this.db.exec(initSql, (err) => {
                    if (err) {
                        console.error('Error initializing database:', err);
                        // We don't reject here to allow partial success? 
                        // Better to log.
                    }
                });

                // 2. Migrations (safe to run even if tables created fresh)
                const migrations = [
                    "ALTER TABLE users ADD COLUMN is_main_store INTEGER DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN suspension_reason TEXT",
                    "ALTER TABLE products ADD COLUMN product_condition TEXT DEFAULT 'used'",
                    "ALTER TABLE products ADD COLUMN youtube_link TEXT"
                ];

                migrations.forEach(migration => {
                    this.db.run(migration, (err) => {
                        // Ignore duplicate column errors
                        if (err && !err.message.includes('duplicate column name')) {
                            // console.error('Migration note:', err.message);
                        }
                    });
                });

                // 3. Signal completion
                // running a simple query to ensure queue is flushed
                this.db.get("SELECT 1", (err) => {
                    if (err) console.error("Database check failed:", err);
                    resolve();
                });
            });
        });
    }

    async execute(sql, params = []) {
        await this.ready; // Wait for initialization to complete

        return new Promise((resolve, reject) => {
            const trimmedSql = sql.trim().toUpperCase();
            const isSelect = trimmedSql.startsWith('SELECT');

            if (isSelect) {
                this.db.all(sql, params, (err, rows) => {
                    if (err) {
                        console.error('SQL Error:', err.message, 'Query:', sql);
                        return reject(err);
                    }
                    resolve([rows, []]);
                });
            } else {
                this.db.run(sql, params, function(err) {
                    if (err) {
                        console.error('SQL Error:', err.message, 'Query:', sql);
                        return reject(err);
                    }
                    // For INSERT, this.lastID is the ID
                    // For UPDATE/DELETE, this.changes is the count
                    resolve([{ insertId: this.lastID, affectedRows: this.changes }, []]);
                });
            }
        });
    }
}

module.exports = {
    createPool: (config) => new SQLitePool(config)
};
