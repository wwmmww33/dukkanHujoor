const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT item, SUM(amount) as total, COUNT(*) as count FROM transactions GROUP BY item", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Items Summary:");
    console.log(rows);
    db.close();
});
