const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const txtPath = path.join(__dirname, 'txt.txt');

const db = new sqlite3.Database(dbPath);

const readFile = () => {
    try {
        const buffer = fs.readFileSync(txtPath);
        console.log('Buffer length:', buffer.length);
        
        // Try UTF-8
        let str = buffer.toString('utf8');
        console.log('UTF-8 length:', str.length);
        if (str.length > 0) return str;
        
        // Try UTF-16LE
        str = buffer.toString('utf16le');
        console.log('UTF-16LE length:', str.length);
        return str;
    } catch (e) {
        console.error('Read error:', e);
        return '';
    }
};

const parseLine = (line) => {
    // Try splitting by tab first
    let parts = line.trim().split('\t');
    
    // If not enough parts, try regex for 2 or more spaces
    if (parts.length < 2) {
        parts = line.trim().split(/\s{2,}/);
    }

    if (parts.length < 2) {
        console.log('Skipping invalid line:', line);
        return null;
    }
    
    const name = parts[0].trim();
    const code = parts[1].trim();
    let phone = parts[2] ? parts[2].trim() : '';
    
    if (phone === '0') phone = '';
    
    return { name, code, phone };
};

const updateMembers = () => {
    const content = readFile();
    console.log('First 100 chars:', JSON.stringify(content.slice(0, 100)));
    const lines = content.split(/\r\n|\r|\n/);
    console.log(`Found ${lines.length} lines.`);
    
    db.serialize(() => {
        // Ensure table exists (id, member_code, name, phone)
        db.run(`CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_code TEXT UNIQUE,
            name TEXT,
            phone TEXT
        )`);

        const stmt = db.prepare(`
            INSERT INTO members (member_code, name, phone) 
            VALUES (?, ?, ?)
            ON CONFLICT(member_code) DO UPDATE SET
            name = excluded.name,
            phone = excluded.phone
        `);

        let count = 0;
        
        db.run("BEGIN TRANSACTION");

        lines.forEach((line, index) => {
            if (!line.trim()) return;
            const member = parseLine(line);
            if (member) {
                stmt.run(member.code, member.name, member.phone, (err) => {
                    if (err) console.error(`Error on line ${index + 1}:`, err.message);
                });
                count++;
            }
        });

        db.run("COMMIT", () => {
            console.log(`Updated ${count} members successfully.`);
            stmt.finalize();
            db.close();
        });
    });
};

updateMembers();
