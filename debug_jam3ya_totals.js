const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Get all members and their active status
    db.all("SELECT member_code, name, is_active FROM members", (err, members) => {
        if (err) { console.error(err); return; }
        
        const inactiveMembers = members.filter(m => m.is_active == 0);
        const inactiveCodes = new Set(inactiveMembers.map(m => String(m.member_code).trim()));
        
        console.log("Total Members:", members.length);
        console.log("Inactive Members:", inactiveMembers.length);
        console.log("Inactive Codes:", Array.from(inactiveCodes));

        // 2. Get all 'Member Contributions' transactions
        db.all("SELECT item, date, amount, details FROM transactions WHERE subject = 'مساهمات الاعضاء'", (err, transactions) => {
            if (err) { console.error(err); return; }

            const totalsByYear = {};
            const totalsByYearActiveOnly = {};

            transactions.forEach(t => {
                const item = String(t.item).trim();
                let amount = t.amount;
                if (typeof amount === 'string') amount = parseFloat(amount.replace(/,/g, ''));
                
                // Determine Year
                let year = '';
                const details = String(t.details || '');
                const yearsInDetails = details.match(/\b20\d{2}\b/g);
                
                if (yearsInDetails && yearsInDetails.length > 0) {
                    // If multiple years, simplified check (just take first or loop?)
                    // The server logic splits amount if multiple years. I'll stick to simple single year check for debug.
                    // Or replicate logic exactly.
                    const coveredYears = yearsInDetails.filter(y => y >= '2023');
                    if (coveredYears.length > 0) {
                        const amountPerYear = amount / coveredYears.length;
                        coveredYears.forEach(y => {
                            totalsByYear[y] = (totalsByYear[y] || 0) + amountPerYear;
                            if (!inactiveCodes.has(item)) {
                                totalsByYearActiveOnly[y] = (totalsByYearActiveOnly[y] || 0) + amountPerYear;
                            }
                        });
                        return; // Done with this transaction
                    }
                }
                
                // Fallback to date
                let dateStr = t.date;
                // Assuming date is stored as string in DB based on server.js logic (it updates it)
                // But in DB it might be raw.
                // server.js: row.date = ...
                if (dateStr && dateStr.length >= 4) {
                    year = dateStr.substring(0, 4);
                }

                if (year >= '2023') {
                     totalsByYear[year] = (totalsByYear[year] || 0) + amount;
                     if (!inactiveCodes.has(item)) {
                        totalsByYearActiveOnly[year] = (totalsByYearActiveOnly[year] || 0) + amount;
                     }
                }
            });

            console.log("\n--- Totals Comparison ---");
            const allYears = new Set([...Object.keys(totalsByYear), ...Object.keys(totalsByYearActiveOnly)]);
            Array.from(allYears).sort().forEach(year => {
                const total = totalsByYear[year] || 0;
                const activeTotal = totalsByYearActiveOnly[year] || 0;
                const diff = total - activeTotal;
                console.log(`Year ${year}: Total=${total.toFixed(3)}, ActiveOnly=${activeTotal.toFixed(3)}, Diff=${diff.toFixed(3)}`);
            });
        });
    });
});
