const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
console.log("Opening database at:", dbPath);
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Error opening DB:", err);
    else console.log("DB opened successfully");
});

db.serialize(() => {
    db.get("SELECT count(*) as count FROM transactions", (err, row) => {
        if (err) {
            console.error("Error counting transactions:", err);
        } else {
            console.log("Transaction count:", row.count);
        }
    });

    db.all("SELECT * FROM transactions LIMIT 5", (err, rows) => {
        if (err) {
            console.error("Error querying transactions:", err);
        } else {
            console.log("Transactions:", rows);
        }
    });
});

db.close((err) => {
    if (err) console.error("Error closing DB:", err);
    else console.log("DB closed");
});
