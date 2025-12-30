const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT id, amount, typeof(amount) as type FROM transactions WHERE typeof(amount) != 'integer' AND typeof(amount) != 'real'", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(`Found ${rows.length} rows with non-numeric amount types:`);
    if (rows.length > 0) {
        console.log(rows.slice(0, 10)); // Show first 10
    }
});

db.all("SELECT id, amount FROM transactions LIMIT 10", [], (err, rows) => {
    if (err) console.error(err);
    else {
        console.log("Sample data:");
        console.log(rows);
    }
    db.close();
});
