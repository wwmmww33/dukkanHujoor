const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT id, amount, balance FROM transactions", [], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        const stmt = db.prepare("UPDATE transactions SET amount = ?, balance = ? WHERE id = ?");
        let fixedCount = 0;

        db.run("BEGIN TRANSACTION");

        rows.forEach(row => {
            let amount = row.amount;
            let balance = row.balance;
            let needsUpdate = false;

            // Fix Amount
            if (typeof amount === 'string' && amount.includes('٫')) {
                amount = parseFloat(amount.replace('٫', '.'));
                needsUpdate = true;
            } else if (typeof amount === 'string') {
                // Try to parse regular strings too just in case
                const parsed = parseFloat(amount);
                if (!isNaN(parsed) && parsed !== amount) {
                     amount = parsed;
                     needsUpdate = true;
                }
            }

            // Fix Balance
            if (typeof balance === 'string' && balance.includes('٫')) {
                balance = parseFloat(balance.replace('٫', '.'));
                needsUpdate = true;
            } else if (typeof balance === 'string') {
                const parsed = parseFloat(balance);
                if (!isNaN(parsed) && parsed !== balance) {
                     balance = parsed;
                     needsUpdate = true;
                }
            }

            if (needsUpdate) {
                stmt.run(amount, balance, row.id);
                fixedCount++;
            }
        });

        stmt.finalize();
        db.run("COMMIT", () => {
            console.log(`Fixed ${fixedCount} rows.`);
            db.close();
        });
    });
});
