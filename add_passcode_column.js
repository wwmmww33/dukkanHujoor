const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

const generateRandomChars = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 2; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

db.serialize(() => {
    // Check if column exists
    db.all("PRAGMA table_info(members)", (err, columns) => {
        if (err) {
            console.error("Error getting table info:", err);
            return;
        }

        const hasPasscode = columns.some(col => col.name === 'passcode');

        if (!hasPasscode) {
            console.log("Adding passcode column...");
            db.run("ALTER TABLE members ADD COLUMN passcode TEXT", (err) => {
                if (err) {
                    console.error("Error adding column:", err);
                    return;
                }
                updatePasscodes();
            });
        } else {
            console.log("Passcode column already exists. Updating empty passcodes...");
            updatePasscodes();
        }
    });
});

function updatePasscodes() {
    db.all("SELECT id, phone, passcode FROM members", (err, rows) => {
        if (err) {
            console.error("Error fetching members:", err);
            return;
        }

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            const stmt = db.prepare("UPDATE members SET passcode = ? WHERE id = ?");
            
            rows.forEach(row => {
                // If passcode already exists and not empty, skip (or maybe user wants to reset? Assuming only new/empty ones for now unless instructed otherwise, but user said "add new field... default passcode is...")
                // User said: "default passcode for EACH member IS phone + 2 random chars". 
                // Since this is a new field request, I should set it for everyone.
                
                // However, for safety, if I already ran this, I shouldn't overwrite if it's already set.
                // But since I just added the column (or user implies this is a new requirement), I will populate it.
                // If the column didn't exist, it's null.
                
                if (!row.passcode) {
                    const phone = row.phone || ''; 
                    // If phone is empty, just 2 random chars? Or keep it empty? 
                    // User said: "phone + 2 random chars". 
                    // Let's assume if phone is empty, just 2 chars.
                    
                    const suffix = generateRandomChars();
                    const newPasscode = phone + suffix;
                    
                    stmt.run(newPasscode, row.id);
                }
            });

            stmt.finalize(() => {
                db.run("COMMIT", (err) => {
                    if (err) console.error("Error committing:", err);
                    else console.log("Passcodes updated successfully.");
                    db.close();
                });
            });
        });
    });
}
