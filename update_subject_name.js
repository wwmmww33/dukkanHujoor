const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

const oldSubject = 'مساهمة استخدام المجلس';
const newSubject = 'رسوم استخدام المجلس';

db.serialize(() => {
    // Check how many rows will be affected
    db.get("SELECT COUNT(*) as count FROM transactions WHERE subject = ?", [oldSubject], (err, row) => {
        if (err) {
            console.error("Error checking count:", err);
            return;
        }
        console.log(`Found ${row.count} transactions with subject '${oldSubject}'`);

        if (row.count > 0) {
            // Perform the update
            db.run("UPDATE transactions SET subject = ? WHERE subject = ?", [newSubject, oldSubject], function(err) {
                if (err) {
                    console.error("Error updating subject:", err);
                } else {
                    console.log(`Successfully updated ${this.changes} rows.`);
                    console.log(`Changed subject from '${oldSubject}' to '${newSubject}'.`);
                }
                db.close();
            });
        } else {
            console.log("No rows to update.");
            db.close();
        }
    });
});
