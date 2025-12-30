const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const xlsx = require('xlsx');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

function excelDateToJSDate(serial) {
    if (!serial || isNaN(serial)) return null;
    const utc_days  = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;                                        
    const date_info = new Date(utc_value * 1000);
    return date_info.toISOString().split('T')[0];
}

async function importData() {
    console.log('Reading Excel file...');
    const workbook = xlsx.readFile('dataJ.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    // Skip header (row 0)
    const rows = data.slice(1);
    
    let lastDate = null;
    let successCount = 0;

    db.serialize(() => {
        // Clear existing data
        db.run("DELETE FROM transactions", (err) => {
            if (err) {
                console.error("Error clearing table:", err);
                return;
            }
            console.log("Cleared existing transactions.");
        });

        // Reset Sequence (Optional but good for cleanliness)
        db.run("DELETE FROM sqlite_sequence WHERE name='transactions'");

        const stmt = db.prepare(`INSERT INTO transactions (date, subject, item, details, amount, balance) VALUES (?, ?, ?, ?, ?, ?)`);

        db.run("BEGIN TRANSACTION");

        rows.forEach((row, index) => {
            if (row.length === 0) return; // Skip completely empty rows

            // Structure: [Date, Subject, Item, Details, Amount]
            // Date is at index 0
            
            let date, subject, item, details, amount;
            let balance = 0; // Default to 0 as it's not in the file

            const col0 = row[0];

            // Check if col0 is a date serial number
            if (typeof col0 === 'number' && col0 > 40000) {
                date = excelDateToJSDate(col0);
                lastDate = date;
            } else if (col0 && typeof col0 === 'string' && col0.match(/^\d{4}-\d{2}-\d{2}$/)) {
                // Already a date string? Unlikely in Excel but possible
                date = col0;
                lastDate = date;
            } else {
                // If empty or not a date, use lastDate
                // But wait, if row[0] is NOT a number, could it be that the row is shifted?
                // The header says "التاريخ" is first. 
                // If the cell is empty in Excel, it might come as null or undefined.
                // If it contains text, it might be a malformed row.
                // Assuming it's a "continuation" row where date is implied from previous.
                date = lastDate;
            }

            subject = row[1];
            item = row[2];
            details = row[3];
            amount = row[4];

            // Validate amount
            if (amount === undefined || amount === null) {
                amount = 0;
            }

            // Only insert if we have some data
            if (!subject && !item && !amount) return;

            stmt.run(date, subject, item, details, amount, balance, (err) => {
                if (err) console.error(`Error inserting row ${index + 2}:`, err.message);
            });
            successCount++;
        });

        stmt.finalize();
        db.run("COMMIT", () => {
            console.log(`Imported ${successCount} transactions successfully.`);
            db.close();
        });
    });
}

importData();
