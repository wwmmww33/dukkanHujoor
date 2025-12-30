const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./dukaazbg_jam3yatKA.sqlite');

db.serialize(() => {
    console.log("--- Members ---");
    db.all("SELECT id, member_code, name, passcode FROM members LIMIT 5", (err, rows) => {
        if (err) console.error(err);
        else console.log(rows);
    });

    console.log("\n--- Income Transactions Sample ---");
    db.all("SELECT id, date, item, amount FROM transactions WHERE amount > 0 LIMIT 10", (err, rows) => {
        if (err) console.error(err);
        else console.log(rows);
    });
});

db.close();