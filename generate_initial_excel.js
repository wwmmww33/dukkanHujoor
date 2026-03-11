
const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const jam3yaDb = new sqlite3.Database(dbPath);

// Helper from server.js
const processJam3yaData = (rows, initialBalance) => {
    let currentBalance = initialBalance;
    rows.forEach(row => {
        let amount = 0;
        if (typeof row.amount === 'number') amount = row.amount;
        else if (typeof row.amount === 'string') {
            const cleanAmount = row.amount.replace(/٫/g, '.').replace(/,/g, '.');
            amount = parseFloat(cleanAmount) || 0;
        }
        row.amount = amount;
        const isApproved = (row.is_approved === undefined || row.is_approved === null) ? 1 : row.is_approved;
        const effectiveAmount = isApproved ? amount : 0;
        currentBalance += effectiveAmount;
        row.balance = currentBalance.toFixed(3);
    });
};

jam3yaDb.serialize(() => {
    jam3yaDb.all("SELECT * FROM transactions ORDER BY date ASC, id ASC", (err, rows) => {
        if (err) { console.error("Error:", err); return; }
        jam3yaDb.all("SELECT member_code, name FROM members", (mErr, members) => {
            if (mErr) { console.error("Error:", mErr); return; }
            
            const nameToCode = {};
            members.forEach(m => {
                const code = String(m.member_code).trim();
                const name = String(m.name).trim();
                nameToCode[name] = code;
            });
            
            processJam3yaData(rows, 0);
            
            const newestFirst = rows.map(t => {
                const rawItem = t.item != null ? String(t.item).trim() : '';
                let displayItem = rawItem;
                if (nameToCode[rawItem]) displayItem = nameToCode[rawItem];
                
                return {
                    date: t.date,
                    subject: t.subject,
                    item: displayItem,
                    details: t.details || '',
                    amount: t.amount,
                    balance: t.balance
                };
            }).reverse();

            const data = [["التسلسل","التاريخ","الموضوع","البند","التفاصيل","القيمة","المجموع التراكمي"]];
            newestFirst.forEach((t, idx) => {
                data.push([
                    idx + 1,
                    t.date,
                    t.subject,
                    t.item,
                    t.details,
                    typeof t.amount === 'number' ? Number(t.amount.toFixed(3)) : t.amount,
                    typeof t.balance === 'string' ? Number(parseFloat(t.balance).toFixed(3)) : t.balance
                ]);
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Transactions");
            
            const publicPath = path.join(__dirname, 'public', 'jam3ya_transactions.xlsx');
            XLSX.writeFile(wb, publicPath);
            console.log('Initial Public Excel file created at:', publicPath);
        });
    });
});
