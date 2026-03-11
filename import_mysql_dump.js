const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');

// Configuration
const SQL_DUMP_FILE = 'dukaazbg_jam3yatKA.sql'; // The file user will provide
const SQLITE_DB_FILE = 'dukaazbg_jam3yatKA.sqlite';

const dbPath = path.join(__dirname, SQLITE_DB_FILE);
const dumpPath = path.join(__dirname, SQL_DUMP_FILE);

if (!fs.existsSync(dumpPath)) {
    console.error(`Error: Dump file '${SQL_DUMP_FILE}' not found! Please place it in the project root.`);
    process.exit(1);
}

// Delete existing SQLite DB to start fresh
if (fs.existsSync(dbPath)) {
    try {
        fs.unlinkSync(dbPath);
        console.log(`Deleted existing ${SQLITE_DB_FILE}`);
    } catch (err) {
        console.error(`Error deleting existing DB: ${err.message}. Make sure the server is stopped.`);
        process.exit(1);
    }
}

const db = new sqlite3.Database(dbPath);

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_admin INTEGER DEFAULT 0,
    is_main_store INTEGER DEFAULT 0,
    is_suspended INTEGER DEFAULT 0,
    suspension_reason TEXT,
    reset_password_token TEXT,
    reset_password_expires DATETIME,
    email TEXT,
    bio TEXT,
    avatar TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATETIME,
    subject TEXT,
    item TEXT,
    details TEXT,
    amount DECIMAL(10, 2),
    balance DECIMAL(10, 2),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_approved INTEGER DEFAULT 1,
    created_by_member INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    nickname TEXT,
    phone TEXT,
    password TEXT,
    passcode TEXT,
    role TEXT DEFAULT 'member',
    status TEXT DEFAULT 'active',
    is_active INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0,
    email TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

db.serialize(() => {
    // 1. Create Schema
    db.exec(schema, (err) => {
        if (err) {
            console.error('Error creating schema:', err);
            return;
        }
        console.log('Schema created.');

        // 2. Process File Line by Line
        const rl = readline.createInterface({
            input: fs.createReadStream(dumpPath),
            crlfDelay: Infinity
        });

        let buffer = '';
        let transactionStarted = false;

        db.exec('BEGIN TRANSACTION;', () => {
            console.log('Started transaction for import...');
        });

        rl.on('line', (line) => {
            line = line.trim();
            if (!line || line.startsWith('--') || line.startsWith('/*')) return;

            buffer += line + ' ';

            if (line.endsWith(';')) {
                // Statement complete
                let statement = buffer.trim();
                buffer = '';

                // We only care about INSERTs for our target tables
                if (statement.toUpperCase().startsWith('INSERT INTO')) {
                    // Check if it's for one of our tables
                    const isTargetTable = ['users', 'transactions', 'members', 'subjects'].some(t => 
                        statement.match(new RegExp(`INSERT INTO \`?${t}\`?`, 'i'))
                    );

                    if (isTargetTable) {
                        // Clean up MySQL specific syntax
                        // 1. Remove backticks
                        let cleanSql = statement.replace(/`/g, '');
                        // 2. Remove MySQLisms like "ON DUPLICATE..."
                        cleanSql = cleanSql.replace(/ON DUPLICATE KEY UPDATE[\s\S]*?;/, ';');
                        // 3. Handle hex binary if any (not expected in this schema)
                        
                        db.run(cleanSql, (err) => {
                            if (err) {
                                // console.error('Insert failed:', err.message);
                                // console.error('Statement start:', cleanSql.substring(0, 50));
                            }
                        });
                    }
                }
            }
        });

        rl.on('close', () => {
            db.exec('COMMIT;', (err) => {
                if (err) console.error('Commit failed:', err);
                else console.log('Import process completed.');
            });
        });
    });
});
