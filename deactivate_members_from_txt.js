const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const listPath = path.join(__dirname, 'txt.txt');

function loadCodes(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    // Normalize Windows CRLF and split
    const lines = raw.replace(/\r/g, '\n').split('\n');
    const codes = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Extract digits only (supports lines like "1278\t" or " 1278 ")
        const match = trimmed.match(/\d+/);
        if (match) codes.push(match[0]);
    }
    // Unique
    return Array.from(new Set(codes));
}

async function run() {
    console.log('Deactivating members listed in txt.txt ...');
    const codes = loadCodes(listPath);
    console.log(`Loaded ${codes.length} unique codes.`);

    const db = new sqlite3.Database(dbPath);

    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare('UPDATE members SET is_active = 0 WHERE member_code = ?');
            let updated = 0;
            let notFound = 0;

            let pending = codes.length;
            if (pending === 0) {
                db.run('COMMIT', (err) => {
                    if (err) reject(err); else resolve();
                });
                return;
            }

            codes.forEach(code => {
                stmt.run(code, function (err) {
                    if (err) {
                        console.error('Update error for code', code, err.message);
                    } else {
                        if (this.changes > 0) updated++;
                        else notFound++;
                    }
                    pending--;
                    if (pending === 0) {
                        stmt.finalize();
                        db.run('COMMIT', (err) => {
                            if (err) reject(err);
                            else {
                                console.log(`Updated (inactive): ${updated}`);
                                console.log(`No matching member_code: ${notFound}`);
                                resolve();
                            }
                        });
                    }
                });
            });
        });
    });

    db.close();
}

run().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
