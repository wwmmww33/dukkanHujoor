require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// استخدام متغير البيئة أو المسار الافتراضي
const dbPath = process.env.JAM3YA_DB_NAME || path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);

console.log(`Connecting to database: ${dbPath}`);

db.serialize(() => {
    // 1. إنشاء جدول الأعضاء (Members Table)
    db.run(`CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_code TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        passcode TEXT,
        notes TEXT,
        is_active INTEGER DEFAULT 1
    )`, (err) => {
        if (err) {
            console.error("Error creating members table:", err);
            return;
        }
        console.log("Members table verified.");
    });

    // 2. التحقق من وجود عمود is_admin وإضافته (Admin Field)
    db.all("PRAGMA table_info(members)", (err, rows) => {
        if (err) {
            console.error("Error checking table info:", err);
            return;
        }
        
        const hasIsAdmin = rows.some(row => row.name === 'is_admin');
        
        if (!hasIsAdmin) {
            console.log("Adding 'is_admin' column...");
            db.run("ALTER TABLE members ADD COLUMN is_admin INTEGER DEFAULT 0", (err) => {
                if (err) console.error("Error adding is_admin column:", err);
                else console.log("'is_admin' column added successfully.");
                setupAdmins();
            });
        } else {
            console.log("'is_admin' column already exists.");
            setupAdmins();
        }
    });
});

function setupAdmins() {
    const targetAdminCode = '1289';

    // 3. تعيين العضو 1289 كمدير (كما طلب المستخدم)
    console.log(`Promoting member ${targetAdminCode} to admin...`);
    db.run("UPDATE members SET is_admin = 1 WHERE member_code = ?", [targetAdminCode], function(err) {
        if (err) {
            console.error("Error updating member 1289:", err);
        } else {
            if (this.changes > 0) {
                console.log(`Successfully promoted member ${targetAdminCode} to admin.`);
            } else {
                console.log(`Member ${targetAdminCode} not found in database.`);
            }
        }

        // 4. التحقق من وجود مدراء بشكل عام (للتأكد)
        checkAndAddDefaultAdmin();
    });
}

function checkAndAddDefaultAdmin() {
    // إضافة مدير افتراضي فقط إذا لم يكن هناك أي مدير على الإطلاق (احتياطي)
    db.get("SELECT COUNT(*) as count FROM members WHERE is_admin = 1", (err, row) => {
        if (err) {
            console.error("Error checking admins:", err);
            db.close();
            return;
        }

        if (row.count === 0) {
            console.log("No admins found. Creating default admin...");
            const defaultAdmin = {
                member_code: 'ADMIN',
                name: 'المدير العام',
                phone: '00000000',
                passcode: '123456',
                is_active: 1,
                is_admin: 1,
                notes: 'تم إنشاؤه تلقائياً بواسطة السكربت'
            };

            db.run(`INSERT INTO members (member_code, name, phone, passcode, is_active, is_admin, notes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                   [defaultAdmin.member_code, defaultAdmin.name, defaultAdmin.phone, defaultAdmin.passcode, 
                    defaultAdmin.is_active, defaultAdmin.is_admin, defaultAdmin.notes], 
                   (err) => {
                if (err) console.error("Error creating default admin:", err);
                else console.log("Default admin created successfully (Code: ADMIN, Pass: 123456).");
                db.close();
            });
        } else {
            console.log(`Total admins in system: ${row.count}`);
            db.close();
        }
    });
}
