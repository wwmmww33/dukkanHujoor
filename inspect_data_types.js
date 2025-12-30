const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT id, amount, typeof(amount) as type FROM transactions WHERE amount > 0 LIMIT 10", (err, rows) => {
    if (err) {
        console.error("Error:", err);
    } else {
        console.log("Positive Transactions:", rows);
        rows.forEach(r => {
             console.log(`ID: ${r.id}, Amount: ${r.amount} (Type: ${typeof r.amount}), JS Comparison (>=0): ${r.amount >= 0}`);
        });
    }
    db.close();
});
