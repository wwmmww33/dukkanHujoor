const mysql = require('mysql2/promise');

class Jam3yaMySQLAdapter {
    constructor(config) {
        // Strip .sqlite extension if present in DB name for MySQL connection
        const dbName = config.database.endsWith('.sqlite') 
            ? config.database.replace('.sqlite', '') 
            : config.database;

        this.pool = mysql.createPool({
            ...config,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            multipleStatements: true // Enable for init script
        });

        this.initializationError = null;
        this.init();
    }

    async init() {
        try {
            // Check if tables exist, if not create them
            const [rows] = await this.pool.execute("SHOW TABLES LIKE 'members'");
            const [subjectRows] = await this.pool.execute("SHOW TABLES LIKE 'subjects'");
            
            if (rows.length === 0 || subjectRows.length === 0) {
                console.log("Jam3ya MySQL tables missing or incomplete. Initializing schema...");
                await this.createSchema();
            } else {
                console.log("Jam3ya MySQL tables found. Checking schema updates...");
                
                // Ensure email column exists in members
                try {
                    await this.pool.query("ALTER TABLE members ADD COLUMN email VARCHAR(255)");
                    console.log("Added email column to members table");
                } catch (e) {
                    // Ignore if column exists
                }

                // Ensure decimal precision is correct (3 decimal places for OMR)
                try {
                    await this.pool.query("ALTER TABLE transactions MODIFY amount DECIMAL(15,3)");
                    await this.pool.query("ALTER TABLE transactions MODIFY balance DECIMAL(15,3)");
                    console.log("Schema updated to DECIMAL(15,3)");
                } catch (e) {
                    console.log("Schema update skipped or failed (might be already updated):", e.message);
                }
            }
        } catch (err) {
            console.error("Jam3ya MySQL Init Error:", err);
            this.initializationError = err;
        }
    }

    async createSchema() {
        const schema = `
            CREATE TABLE IF NOT EXISTS members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                member_code VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                nickname VARCHAR(255),
                phone VARCHAR(255),
                email VARCHAR(255),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                passcode VARCHAR(255),
                notes TEXT,
                is_active TINYINT(1) DEFAULT 1,
                is_admin TINYINT(1) DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS subjects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                date DATETIME,
                subject VARCHAR(255),
                item VARCHAR(255),
                details TEXT,
                amount DECIMAL(15,3),
                balance DECIMAL(15,3),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        try {
            await this.pool.query(schema);
            console.log("Jam3ya schema created successfully.");
        } catch (err) {
            console.error("Schema Creation Error:", err);
        }
    }

    // Mimic sqlite3.all
    all(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (this.initializationError) return callback(this.initializationError);
        // Use query instead of execute for better compatibility
        this.pool.query(this.convertSql(sql), params)
            .then(([rows]) => callback(null, rows))
            .catch(err => callback(err));
    }

    // Mimic sqlite3.get
    get(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (this.initializationError) return callback(this.initializationError);
        this.pool.query(this.convertSql(sql), params)
            .then(([rows]) => callback(null, rows[0])) // Return first row
            .catch(err => callback(err));
    }

    // Mimic sqlite3.run
    run(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (this.initializationError) return callback ? callback(this.initializationError) : null;
        this.pool.query(this.convertSql(sql), params)
            .then(([result]) => {
                // Mimic 'this' context of sqlite3 run callback which has lastID and changes
                const context = {
                    lastID: result.insertId,
                    changes: result.affectedRows
                };
                if (callback) callback.call(context, null);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    }

    // Mimic sqlite3.serialize (MySQL pool is already parallel/queued, but we just run callback)
    serialize(callback) {
        callback();
    }

    // Helper to convert SQLite SQL to MySQL if needed
    convertSql(sql) {
        // SQLite uses ? for params, MySQL uses ? too. 
        // Some syntax might differ but basic SELECT/INSERT/UPDATE is mostly compatible.
        return sql;
    }
}

module.exports = Jam3yaMySQLAdapter;