const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const xlsx = require('xlsx');
const bcrypt = require('bcrypt');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

async function importUsers() {
    console.log('Reading Book1.xlsx...');
    const workbook = xlsx.readFile('Book1.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    // Skip header (row 0)
    const rows = data.slice(1);
    let successCount = 0;
    let failCount = 0;

    // Use a default password if missing, or hash the provided one
    // For this import, since we need to allow login, we'll hash the password.
    // If password column is empty in Excel (index 3), what should we do?
    // User input says: "جدول المستخدمين يحتوي على رقم المستخدم والاسم ورقم الهاتف والرمز السري"
    // The inspection showed the password column might be empty for some rows.
    // Let's assume a default password if missing, or maybe the phone number is the default password?
    // For safety, let's set a default password '123456' if missing, but print a warning.
    
    const saltRounds = 10;
    const defaultPasswordHash = await bcrypt.hash('123456', saltRounds);

    const stmt = db.prepare(`INSERT OR IGNORE INTO users (id, name, phone, password) VALUES (?, ?, ?, ?)`);

    // Let's do it properly with async/await
    (async () => {
        try {
            await new Promise((resolve, reject) => {
                db.run("BEGIN TRANSACTION", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            for (const row of rows) {
                if (row.length < 2) continue; // Skip empty rows

                const id = row[0];
                const name = row[1];
                let phone = row[2];
                let rawPassword = row[3];

                if (!name) continue;

                // Normalize phone: remove non-digits
                if (phone) {
                    phone = String(phone).replace(/\D/g, '');
                } else {
                    // Generate a dummy phone if missing to satisfy UNIQUE constraint? 
                    // Or skip? Let's skip if no phone as it's a login identifier usually.
                    console.log(`Skipping user ${name} (ID: ${id}) - No phone number`);
                    failCount++;
                    continue;
                }

                let passwordHash;
                if (rawPassword) {
                    passwordHash = await bcrypt.hash(String(rawPassword), saltRounds);
                } else {
                    passwordHash = defaultPasswordHash;
                }

                await new Promise((resolve) => {
                    stmt.run(id, name, phone, passwordHash, (err) => {
                        if (err) {
                            console.error(`Error inserting user ${name}:`, err.message);
                            failCount++;
                        } else {
                            successCount++;
                        }
                        resolve();
                    });
                });
            }

            stmt.finalize();
            
            await new Promise((resolve, reject) => {
                db.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log(`Imported ${successCount} users successfully.`);
            console.log(`Failed/Skipped: ${failCount}`);
            db.close();

        } catch (error) {
            console.error("Import failed:", error);
            db.run("ROLLBACK");
            db.close();
        }
    })();
}

importUsers();
