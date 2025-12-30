const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

function excelDateToJSDate(serial) {
   const utc_days  = Math.floor(serial - 25569);
   const utc_value = utc_days * 86400;                                        
   const date_info = new Date(utc_value * 1000);

   const fractional_day = serial - Math.floor(serial) + 0.0000001;

   let total_seconds = Math.floor(86400 * fractional_day);

   const seconds = total_seconds % 60;

   total_seconds -= seconds;

   const hours = Math.floor(total_seconds / (60 * 60));
   const minutes = Math.floor(total_seconds / 60) % 60;

   return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
}

function formatDate(date) {
    if (!date) return null;
    if (typeof date === 'string') return date; // Already string
    const d = new Date(date);
    const month = '' + (d.getMonth() + 1);
    const day = '' + d.getDate();
    const year = d.getFullYear();

    return [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
}

async function runImport() {
    console.log('Starting Data Import...');

    // 1. Process Nicknames
    console.log('Processing Nicknames...');
    try {
        const nicknamesContent = fs.readFileSync('nicknames.txt', 'utf8');
        const lines = nicknamesContent.split('\n');
        
        let updatedNicknames = 0;

        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare("UPDATE members SET nickname = ? WHERE member_code = ?");
                
                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/); // Split by any whitespace (tab or space)
                    if (parts.length >= 2) {
                        const code = parts[0];
                        // Join the rest in case name has spaces, though example showed single name
                        const nickname = parts.slice(1).join(' '); 
                        
                        stmt.run(nickname, code, function(err) {
                            if (!err && this.changes > 0) {
                                updatedNicknames++;
                            }
                        });
                    }
                });
                
                stmt.finalize((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
        console.log(`Updated ${updatedNicknames} nicknames.`);

    } catch (err) {
        console.error('Error processing nicknames:', err.message);
    }

    // 2. Process Transactions
    console.log('Processing Transactions from Excel...');
    try {
        const workbook = XLSX.readFile('transactions.xlsx');
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Array of arrays

        // Headers: [ 'التاريخ', 'الموضوع', 'البند', 'تفاصيل', 'القيمة' ]
        // Indices: 0: Date, 1: Subject, 2: Item, 3: Details, 4: Amount

        const transactions = [];
        // Skip header row
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            let dateRaw = row[0];
            let subject = row[1];
            let item = row[2];
            let details = row[3];
            let amount = row[4];

            // Validate essential data
            if (amount === undefined || amount === null || amount === '') continue;

            let dateStr = null;
            if (typeof dateRaw === 'number') {
                const dateObj = excelDateToJSDate(dateRaw);
                dateStr = formatDate(dateObj);
            } else if (typeof dateRaw === 'string') {
                dateStr = dateRaw; // Assume already formatted or handle if needed
            }

            // Clean strings
            subject = subject ? String(subject).trim() : '';
            item = item ? String(item).trim() : '';
            details = details ? String(details).trim() : '';
            
            // Determine type (Income/Expense) - Logic from current app structure
            // In the app: is_income is 1 if amount > 0, 0 if amount < 0.
            // But actually amount is stored signed.
            // Let's check db schema if possible, or assume standard structure.
            // Usually we store amount directly.
            
            // Check if item is a member code (numeric)
            let isMember = 0;
            // Simple heuristic: if item matches a number pattern, it might be a member code
            // But in the excel 'البند' can be text description too.
            // In the app, 'item' column stores member code OR text. 'is_member' flag tells which.
            // Let's try to match 'item' against member codes in DB?
            // Or just use regex: if it looks like a member code (3-4 digits).
            if (/^\d+$/.test(item)) {
                isMember = 1;
            }

            transactions.push({
                date: dateStr,
                subject: subject,
                item: item,
                details: details,
                amount: parseFloat(amount),
                is_member: isMember
            });
        }

        console.log(`Found ${transactions.length} valid transactions in Excel.`);

        // Clear existing transactions and Insert new ones
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                // DELETE ALL
                db.run("DELETE FROM transactions", (err) => {
                    if (err) {
                        console.error('Error deleting old transactions:', err);
                        return reject(err);
                    }
                    console.log('Cleared old transactions table.');
                });

                // Reset Auto Increment (optional but good for clean start)
                db.run("DELETE FROM sqlite_sequence WHERE name='transactions'");

                const stmt = db.prepare(`
                    INSERT INTO transactions 
                    (date, subject, item, amount, details, created_at) 
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                `);

                let insertedCount = 0;
                db.run("BEGIN TRANSACTION");

                transactions.forEach(t => {
                    stmt.run(t.date, t.subject, t.item, t.amount, t.details, (err) => {
                        if (err) console.error('Insert error:', err);
                        else insertedCount++;
                    });
                });

                db.run("COMMIT", (err) => {
                    stmt.finalize();
                    if (err) reject(err);
                    else {
                        console.log(`Successfully inserted ${insertedCount} transactions.`);
                        resolve();
                    }
                });
            });
        });

    } catch (err) {
        console.error('Error processing transactions:', err.message);
    } finally {
        db.close();
    }
}

runImport();
