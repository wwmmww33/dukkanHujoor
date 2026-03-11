// =============================================================================
// الخادم النهائي والشامل - دكان الحجور - V12 (مع إصلاح Title و Session Store)
// =============================================================================
require('dotenv').config();
const nodemailer = require('nodemailer');
const i18n = require('i18n');
const cookieParser = require('cookie-parser'); // س
// --- i18n Configuration ---
i18n.configure({
    locales: ['ar', 'en', 'hi', 'bn', 'fa'],
    defaultLocale: 'ar',
    cookie: 'locale', // اسم الكوكي الذي سيخزن اللغة المختارة
    directory: __dirname + '/locales',
    autoReload: true,
    syncFiles: true,
    objectNotation: true, // يسمح لنا بتنظيم الترجمات بشكل هرمي
});


const { getAIsuggestedCategory } = require('./ai-classifier');
const express = require('express');
const XLSX = require('xlsx');
const { initJam3ya } = require('./services/jam3ya');
const { buildJam3yaRouter } = require('./routes/jam3ya');
const { createJam3yaReminders } = require('./services/jam3yaReminders');

// Safe SQLite3 Loading
let sqlite3;
let jam3yaDb;
let jam3yaDbError = null;

try {
    sqlite3 = require('sqlite3').verbose();
} catch (e) {
    console.error("WARNING: SQLite3 module not found. Jam'iya features will be disabled.", e.message);
    jam3yaDbError = "SQLite3 module not found: " + e.message;
}

// Database & Session Configuration based on Environment
let mysql;
let SessionStore;
let sessionStoreOptions;
let dbAvailable = true;
let dbError = null;

const session = require('express-session');

if (process.env.NODE_ENV === 'production') {
    // Production: Use MySQL
    try {
        mysql = require('mysql2/promise');
        SessionStore = require('express-mysql-session')(session);
        sessionStoreOptions = {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        };
    } catch (e) {
        console.error("Production DB Init Error:", e);
        dbAvailable = false;
        dbError = e.message;
        SessionStore = session.MemoryStore;
        sessionStoreOptions = {};
    }
} else {
    // Development: Use SQLite Wrapper
    try {
        mysql = require('./sqlite-wrapper');
        try {
            SessionStore = require('connect-sqlite3')(session);
            sessionStoreOptions = { db: 'sessions.sqlite', dir: __dirname };
        } catch (e) {
            console.warn("SQLite session store failed, falling back to MemoryStore:", e.message);
            SessionStore = session.MemoryStore;
            sessionStoreOptions = {};
        }
    } catch (e) {
        console.error("Development DB Init Error:", e);
        dbAvailable = false;
        dbError = e.message;
        // Mock mysql to prevent crash on createPool
        mysql = { 
            createPool: () => ({ 
                execute: async () => { throw new Error("DB Unavailable"); } 
            }) 
        };
        SessionStore = session.MemoryStore;
        sessionStoreOptions = {};
    }
}

const bcrypt = require('bcrypt');
// const session = require('express-session'); // Moved to top
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const sharp = require('sharp');
const crypto = require('crypto');
const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);

let pool;
if (dbAvailable) {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    } catch (e) {
        console.error("Pool Creation Error:", e);
        dbAvailable = false;
        dbError = e.message;
        pool = { execute: async () => { throw new Error("DB Unavailable"); } };
    }
} else {
    pool = { execute: async () => { throw new Error("DB Unavailable"); } };
}

// Global DB Check Middleware
app.use((req, res, next) => {
    if (!dbAvailable && !req.path.startsWith('/uploads') && !req.path.startsWith('/css') && !req.path.startsWith('/js')) {
        return res.status(503).send(`
            <div style="text-align:center; padding:50px; font-family:sans-serif;">
                <h1>Service Unavailable / الخدمة غير متاحة</h1>
                <p>The system database is currently unavailable.</p>
                <p>نظام قاعدة البيانات غير متاح حالياً.</p>
                <p><small>Error: ${dbError}</small></p>
            </div>
        `);
    }
    next();
});

// Jam3ya Database Connection
// const Jam3yaMySQLAdapter = require('./jam3ya-mysql-adapter');

// Timezone Helper (GMT+4)
const getGulfDate = () => {
    const now = new Date();
    const offset = 4 * 60 * 60 * 1000; // 4 Hours
    return new Date(now.getTime() + offset);
};
const getGulfDateString = () => getGulfDate().toISOString().split('T')[0];
const getGulfDateTimeString = () => getGulfDate().toISOString();

// Function to attempt MySQL connection (Fallback)
const tryMysqlFallback = () => {
    if (process.env.NODE_ENV === 'production') {
        console.log("Attempting MySQL fallback for Jam3ya...");
        try {
            const Jam3yaMySQLAdapter = require('./jam3ya-mysql-adapter');
            jam3yaDb = new Jam3yaMySQLAdapter({
                host: process.env.JAM3YA_DB_HOST,
                user: process.env.JAM3YA_DB_USER,
                password: process.env.JAM3YA_DB_PASSWORD,
                database: process.env.JAM3YA_DB_NAME
            });
            jam3yaDbError = null; // Clear error if MySQL works
            console.log("Connected to Jam3ya database (MySQL Fallback)");
        } catch (e) {
            console.error("Jam3ya MySQL Connection Error:", e);
            jam3yaDbError = (jam3yaDbError ? jam3yaDbError + " | " : "") + "MySQL Fallback Failed: " + e.message;
            jam3yaDb = null;
        }
    } else {
        console.log("MySQL fallback skipped (not production)");
    }
};
// Ensure approval columns if MySQL fallback was successful
setTimeout(() => {
    if (jam3yaDb && !jam3yaDbError) {
        try {
            jam3yaDb.run("ALTER TABLE members ADD COLUMN email VARCHAR(255)", () => {});
            jam3yaDb.run("ALTER TABLE transactions ADD COLUMN is_approved TINYINT DEFAULT 1", () => {});
            jam3yaDb.run("ALTER TABLE transactions ADD COLUMN created_by_member TINYINT DEFAULT 0", () => {});
        } catch (e) {}
    }
}, 1500);

// Primary Connection Logic
if (process.env.NODE_ENV === 'production') {
    // In Production: Always prefer MySQL
    console.log("Production environment: Prioritizing MySQL for Jam'iya.");
    tryMysqlFallback();
}

// Fallback to SQLite (Development OR Production Fallback)
// Jam3ya initialization moved to services/jam3ya.js
// (keeps same jam3yaDb / jam3yaDbError variables used later)
{
    let Jam3yaMySQLAdapter = null;
    if (process.env.NODE_ENV === 'production') {
        try {
            Jam3yaMySQLAdapter = require('./jam3ya-mysql-adapter');
        } catch (e) {
            // ignore - will fall back to sqlite if available
        }
    }
    const jam3yaInit = initJam3ya({ sqlite3, Jam3yaMySQLAdapter, env: process.env, baseDir: __dirname });
    jam3yaDb = jam3yaInit.jam3yaDb;
    jam3yaDbError = jam3yaInit.jam3yaDbError;
}

const sessionStore = new SessionStore(sessionStoreOptions);

// Middlewares
app.use(cookieParser());
app.use(i18n.init);
app.use((req, res, next) => {
    res.locals.__ = res.__; // دالة الترجمة الرئيسية
    res.locals.locale = req.getLocale(); // اللغة الحالية
    next();
});
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Global maintenance mode (disable the whole site)
const siteEnabled = (process.env.SITE_ENABLED || 'true') === 'true';
if (!siteEnabled) {
    app.use((req, res, next) => {
        // Allow static files so the maintenance page can still look good
        const p = req.path || '';
        if (p.startsWith('/uploads') || p.startsWith('/css') || p.startsWith('/js') || p.startsWith('/public')) {
            return next();
        }
        return res.status(503).send(`
            <div style="max-width: 720px; margin: 60px auto; padding: 28px; font-family: Arial, sans-serif; direction: rtl; text-align: center; border: 1px solid #eee; border-radius: 12px;">
                <h2 style="margin: 0 0 12px; color: #2c3e50;">الموقع متوقف مؤقتًا</h2>
                <p style="margin: 0 0 16px; color: #555; line-height: 1.7;">نعتذر عن الإزعاج، الموقع غير متاح حاليًا بسبب صيانة أو تحديثات. يرجى المحاولة لاحقًا.</p>
                <p style="margin: 0; color: #888; font-size: 0.9em;">(HTTP 503 Service Unavailable)</p>
            </div>
        `);
    });
}

app.use(session({
    key: 'session_cookie_name',
    secret: process.env.SESSION_SECRET || 'a-very-strong-fallback-secret-key-for-dukan',
    store: sessionStore, // <-- لإصلاح MemoryStore
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // يجب أن يكون true إذا كنت تستخدم https
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // يوم واحد
    }
}));

// Mount Jam3ya module under /jam3ya (Option A: same app, separated router)
const jam3yaEnabled = (process.env.JAM3YA_ENABLED || 'true') === 'true';

if (jam3yaEnabled) {
    app.use(
        '/jam3ya',
        buildJam3yaRouter({
            jam3yaDb,
            jam3yaDbError,
            getGulfDateString,
            getGulfDateTimeString,
            baseUrl: process.env.BASE_URL || 'http://localhost:3000'
        })
    );
} else {
    // Friendly maintenance page when Jam3ya is disabled
    app.use('/jam3ya', (req, res) => {
        res.status(503).send(`
            <div style="max-width: 600px; margin: 60px auto; padding: 24px; font-family: Arial, sans-serif; direction: rtl; text-align: center; border: 1px solid #eee; border-radius: 12px;">
                <h2 style="margin: 0 0 12px; color: #2c3e50;">الجمعية متوقفة مؤقتًا</h2>
                <p style="margin: 0 0 16px; color: #555; line-height: 1.7;">نعتذر عن الإزعاج، خدمات الجمعية غير متاحة حاليًا بسبب صيانة أو تحديثات. يرجى المحاولة لاحقًا.</p>
                <a href="/" style="display: inline-block; background: #27ae60; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none;">العودة للمتجر</a>
            </div>
        `);
    });
}

// Jam3ya reminders: manual + automatic (as before)
if (jam3yaEnabled && process.env.JAM3YA_REMINDERS_ENABLED === 'true') {
    try {
        if (!jam3yaDb || jam3yaDbError) {
            console.warn('Jam3ya reminders scheduling skipped: Jam3ya DB unavailable');
        } else {
            const { scheduleNextReminder } = createJam3yaReminders({ jam3yaDb, env: process.env });
            scheduleNextReminder();
            console.log('Jam3ya reminders scheduling enabled');
        }
    } catch (e) {
        console.error('Failed to start Jam3ya reminders scheduler:', e);
    }
}

// Visitor Tracking Middleware (Disabled - Logging only on successful login as per request)
// app.use((req, res, next) => {
//     // Log only specific entry points to reduce noise
//     const allowedPaths = ['/', '/login', '/jam3ya'];
//     
//     if (jam3yaDb && req.method === 'GET' && allowedPaths.includes(req.path)) {
//         const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
//         const path = req.originalUrl;
//         const ua = req.get('User-Agent') || '';
//         const date = new Date().toISOString();
//         const memberName = (req.session && req.session.jam3ya_member_name) || (req.session && req.session.jam3ya_admin ? 'مدير النظام' : null);
//         
//         // Simple bot filter (optional)
//         if (!ua.includes('bot') && !ua.includes('spider') && !ua.includes('crawl')) {
//              jam3yaDb.run("INSERT INTO visitors (ip, path, date, user_agent, member_name) VALUES (?, ?, ?, ?, ?)", [ip, path, date, ua, memberName], (err) => {
//                  if (err) console.error("Visitor Log Error:", err.message);
//              });
//         }
//     }
//     next();
// });

// Jam3ya visitor logging + routes were moved to routes/jam3ya.js

app.use((req, res, next) => { res.locals.user = req.session.user || null; res.locals.query = req.query; next(); });

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };
const requireAdmin = (req, res, next) => { if (!req.session.user || !req.session.user.is_admin) return res.redirect('/'); next(); };

const compressImage = async (fileBuffer) => {
    if (!fileBuffer) return null;

    // 1. إنشاء اسم ملف جديد وفريد بالصيغة .webp
    const newFilename = `compressed-${Date.now()}.webp`;
    const newPath = path.join(__dirname, 'uploads', newFilename);

    try {
        await sharp(fileBuffer)
            // 2. تغيير أبعاد الصورة: لن تتجاوز 1024x1024 بكسل مع الحفاظ على الأبعاد
            .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
            // 3. تحويل الصيغة إلى WebP مع جودة 80% (توازن ممتاز بين الجودة والحجم)
            .toFormat('webp', { quality: 80 })
            // 4. حفظ الصورة المضغوطة الجديدة في مجلد "uploads"
            .toFile(newPath);
            
        return newFilename; // إرجاع اسم الملف الجديد ليتم حفظه في قاعدة البيانات
    } catch (error) {
        console.error("Image compression error:", error);
        return null;
    }
};
// Jam3ya reminders moved to services/jam3yaReminders.js and are invoked from routes/jam3ya.js

// =============================================================================
// المسارات (Routes)

app.get('/', async (req, res) => {
    try {
        // 1. ابحث عن المستخدم المحدد كـ "الدكان الرئيسي"
        const [mainUserRows] = await pool.execute('SELECT id, name FROM users WHERE is_main_store = 1 LIMIT 1');
        
        let mainUserId = null;
        if (mainUserRows.length > 0) {
            mainUserId = mainUserRows[0].id;
        } else {
            // خطة احتياطية: إذا لم يتم تحديد أي مستخدم رئيسي، اعرض جميع المنتجات كالسابق
            // (يمكنك تعديل هذا السلوك لاحقًا)
            const [products] = await pool.execute(`
                SELECT p.*, p.title as name, u.name as seller_name, u.phone as seller_phone, c.name as category_name 
                FROM products p JOIN users u ON p.user_id = u.id LEFT JOIN categories c ON p.category_id = c.id 
                WHERE p.status = 'available' AND p.admin_hidden = 0 
                ORDER BY p.created_at DESC`
            );
            const [categories] = await pool.execute("SELECT * FROM categories ORDER BY name");
            return res.render('index', {
                title: 'دكان الحجور - السوق العام',
                products,
                categories,
                selectedCategory: 'all',
                req: req
            });
        }

        // 2. جلب جميع منتجات هذا المستخدم الرئيسي فقط
        const categoryId = req.query.category;
        let query = `
            SELECT p.*, p.title as name, u.name as seller_name, u.phone as seller_phone, c.name as category_name
            FROM products p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.user_id = ? AND p.status = 'available' AND p.admin_hidden = 0
        `;
        const params = [mainUserId];

        if (categoryId && categoryId !== 'all') {
            query += ' AND p.category_id = ?';
            params.push(categoryId);
        }
        query += ' ORDER BY p.created_at DESC';

        const [products] = await pool.execute(query, params);
        const [categories] = await pool.execute("SELECT * FROM categories WHERE id IN (SELECT DISTINCT category_id FROM products WHERE user_id = ?)", [mainUserId]);
        
        res.render('index', {
            title: `دكان ${mainUserRows[0].name}`, // عنوان الصفحة يصبح اسم الدكان
            products,
            categories,
            selectedCategory: categoryId || 'all',
            req: req
        });

    } catch (error) {
        console.error("Homepage Error:", error);
        res.status(500).send("Server Error");
    }
});

// NOTE: Jam3ya routes moved to routes/jam3ya.js and mounted at /jam3ya above.

// Jam3ya admin/dashboard routes were moved to routes/jam3ya.js and mounted at /jam3ya.

/*
    NOTE: Legacy inline Jam3ya routes below are now disabled.
    They have been (or will be) migrated into routes/jam3ya.js.
    Keeping them commented avoids runtime errors like requireJam3yaAdmin not defined,
    and prevents double-handling of /jam3ya/* paths.
*/

/*

// Handle Delete Transaction
app.post('/jam3ya/transactions/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    
    jam3yaDb.serialize(() => {
        jam3yaDb.run(
            "DELETE FROM obligation_payments WHERE transaction_id = ?",
            [id],
            (payErr) => {
                if (payErr) {
                    console.error("Obligation Payment Delete Error:", payErr);
                }
                jam3yaDb.run("DELETE FROM transactions WHERE id = ?", [id], async (err) => {
                    if (err) {
                        console.error("Transaction Delete Error:", err);
                        return res.status(500).send("Error deleting transaction");
                    }
                    await updatePublicExcelFile();
                    res.redirect('/jam3ya/dashboard?tab=transactions');
                });
            }
        );
    });
});

// Approve pending transaction
app.post('/jam3ya/transactions/approve', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run("UPDATE transactions SET is_approved = 1 WHERE id = ?", [id], async (err) => {
        if (err) {
            console.error("Transaction Approve Error:", err);
            return res.status(500).send("Error approving transaction");
        }
        await updatePublicExcelFile();
        res.redirect('/jam3ya/dashboard?tab=transactions');
    });
});

// Jam'iya Dashboard
app.get('/jam3ya/dashboard', requireJam3yaAdmin, (req, res) => {
    const adminName = req.session.jam3ya_admin_name || 'مدير النظام';

    const dbAll = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            jam3yaDb.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    };

    jam3yaDb.serialize(async () => {
        try {
            const members = await dbAll("SELECT * FROM members ORDER BY name ASC");

            let subjects = [];
            try {
                subjects = await dbAll("SELECT * FROM subjects ORDER BY name ASC");
            } catch (err) {
                if (err.message && err.message.includes("Table") && err.message.includes("doesn't exist")) {
                    subjects = [];
                } else {
                    return res.status(500).send("DB Error (Subjects): " + err.message);
                }
            }

            let infoMessages = [];
            try {
                infoMessages = await dbAll("SELECT * FROM info_messages ORDER BY created_at DESC");
            } catch (err) {
                infoMessages = [];
            }

            const transactions = await dbAll("SELECT * FROM transactions ORDER BY date ASC, id ASC");

            const recentSubjects = [];
            const seenSubjects = new Set();
            [...transactions].reverse().forEach(t => {
                const subjectName = (t.subject || '').trim();
                if (!subjectName) return;
                if (seenSubjects.has(subjectName)) return;
                seenSubjects.add(subjectName);
                recentSubjects.push(subjectName);
            });
            const activeSubjects = recentSubjects.slice(0, 4);

            const mainData = processJam3yaData(transactions, 0);

            let obligationsRows = [];
            try {
                obligationsRows = await dbAll(
                    "SELECT o.id, o.subject, o.description, o.total_amount, " +
                    "COALESCE(SUM(p.amount), 0) AS paid_amount " +
                    "FROM obligations o " +
                    "LEFT JOIN obligation_payments p ON p.obligation_id = o.id " +
                    "GROUP BY o.id " +
                    "ORDER BY o.id DESC"
                );
            } catch (err) {
                obligationsRows = [];
            }

            let obligations = [];
            if (obligationsRows && Array.isArray(obligationsRows)) {
                obligations = obligationsRows.map(o => {
                    const paid = Number(o.paid_amount || 0);
                    const total = Number(o.total_amount || 0);
                    const remaining = total - paid;
                    let status = 'open';
                    if (paid <= 0) status = 'open';
                    else if (remaining > 0) status = 'partial';
                    else status = 'settled';
                    return {
                        id: o.id,
                        subject: o.subject,
                        description: o.description,
                        total_amount: total,
                        paid_amount: paid,
                        remaining_amount: remaining,
                        status
                    };
                });
            }

            let visitors = [];
            try {
                visitors = await dbAll("SELECT * FROM visitors ORDER BY id DESC LIMIT 200");
            } catch (err) {
                visitors = [];
            }

            const memberMap = {};
            members.forEach(m => {
                memberMap[m.member_code] = m.name;
            });

            const processedTransactions = transactions.map(t => {
                let displayItem = t.item;
                let isMember = false;

                if (memberMap[t.item]) {
                    displayItem = memberMap[t.item];
                    isMember = true;
                }

                return {
                    ...t,
                    displayItem,
                    isMember
                };
            }).reverse();

            const currentYear = new Date().getFullYear().toString();
            const targetYear = req.query.unpaid_year || currentYear;
            const paidMemberCodes = new Set();

            const paymentReport = {};
            const yearsSet = new Set(['2023', '2024', currentYear, targetYear]);

            transactions.forEach(t => {
                let dateStr = t.date;
                if (t.date instanceof Date) {
                    dateStr = t.date.toISOString().split('T')[0];
                } else {
                    dateStr = String(t.date);
                }

                t.date = dateStr;

                const subject = (t.subject || '').trim();
                const item = (t.item || '').toString().trim();
                let details = (t.details || '').toString();
                details = details.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

                if (subject === 'مساهمات الاعضاء') {
                    const yearsInDetails = details.match(/\b20\d{2}\b/g);

                    let isPaidForTargetYear = false;

                    let coveredYears = [];
                    if (yearsInDetails && yearsInDetails.length > 0) {
                        coveredYears = yearsInDetails;
                    } else {
                        if (dateStr) {
                            coveredYears = [dateStr.split('-')[0]];
                        }
                    }

                    if (!paymentReport[item]) paymentReport[item] = {};
                    coveredYears.forEach(year => {
                        if (year >= '2023') {
                            yearsSet.add(year);
                            if (!paymentReport[item][year]) paymentReport[item][year] = 0;
                            const amountPerYear = t.amount / coveredYears.length;
                            paymentReport[item][year] += amountPerYear;
                        }
                    });

                    if (yearsInDetails && yearsInDetails.length > 0) {
                        if (yearsInDetails.includes(targetYear)) {
                            isPaidForTargetYear = true;
                        }
                    } else {
                        if (dateStr && dateStr.startsWith(targetYear)) {
                            isPaidForTargetYear = true;
                        }
                    }

                    if (isPaidForTargetYear) {
                        paidMemberCodes.add(item);
                    }
                }
            });

            const sortedYears = Array.from(yearsSet).sort();

            const yearlyTotals = {};
            sortedYears.forEach(year => {
                yearlyTotals[year] = 0;
            });

            Object.entries(paymentReport).forEach(([, memberPayments]) => {
                for (const [year, amount] of Object.entries(memberPayments)) {
                    if (yearlyTotals[year] !== undefined) {
                        yearlyTotals[year] += amount;
                    }
                }
            });

            const unpaidMembers = members.filter(m => {
                const memberCode = (m.member_code || '').toString().trim();
                const isActive = (m.is_active == 1 || m.is_active == null);

                if (!isActive) return false;
                if (paidMemberCodes.has(memberCode)) return false;

                return true;
            });

            res.render('jam3ya-dashboard', {
                members,
                subjects,
                activeSubjects,
                transactions: processedTransactions,
                unpaidMembers,
                targetYear,
                paymentReport,
                yearlyTotals,
                sortedYears,
                obligations,
                mainData,
                adminName,
                visitors,
                infoMessages,
                layout: false
            });
        } catch (err) {
            console.error("Jam3ya Dashboard Error:", err);
            res.status(500).send("Database Error");
        }
    });
});

// Export transactions to Excel (newest first)
app.get('/jam3ya/export/excel', requireJam3yaAdmin, (req, res) => {
    jam3yaDb.serialize(() => {
        jam3yaDb.all("SELECT * FROM transactions ORDER BY date ASC, id ASC", (err, rows) => {
            if (err) return res.status(500).send("DB Error (Transactions): " + err.message);
            jam3yaDb.all("SELECT member_code, name FROM members", (mErr, members) => {
                if (mErr) return res.status(500).send("DB Error (Members): " + mErr.message);
                const codeToName = {};
                const nameToCode = {};
                members.forEach(m => {
                    const code = String(m.member_code).trim();
                    const name = String(m.name).trim();
                    codeToName[code] = name;
                    nameToCode[name] = code;
                });
                const processed = processJam3yaData(rows, 0);
                const modeParam = String(req.query.mode || '').toLowerCase();
                const mode = (modeParam === 'names') ? 'names' : 'codes';
                console.log(`[Export Excel] modeParam=${modeParam} resolved=${mode}, rows=${rows.length}, members=${members.length}`);
                const newestFirst = rows.map(t => {
                    const rawItem = t.item != null ? String(t.item).trim() : '';
                    let displayItem = rawItem;
                    if (mode === 'names' && codeToName[rawItem]) displayItem = codeToName[rawItem];
                    else if (mode === 'codes' && nameToCode[rawItem]) displayItem = nameToCode[rawItem];
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
                const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename="jam3ya-transactions.xlsx"');
                res.send(buf);
            });
        });
    });
});

// Export printable HTML for PDF saving (newest first)
app.get('/jam3ya/export/pdf', requireJam3yaAdmin, (req, res) => {
    jam3yaDb.serialize(() => {
        jam3yaDb.all("SELECT * FROM transactions ORDER BY date ASC, id ASC", (err, rows) => {
            if (err) return res.status(500).send("DB Error (Transactions): " + err.message);
            jam3yaDb.all("SELECT member_code, name FROM members", (mErr, members) => {
                if (mErr) return res.status(500).send("DB Error (Members): " + mErr.message);
                const codeToName = {};
                const nameToCode = {};
                members.forEach(m => {
                    const code = String(m.member_code).trim();
                    const name = String(m.name).trim();
                    codeToName[code] = name;
                    nameToCode[name] = code;
                });
                processJam3yaData(rows, 0);
                const modeParam = String(req.query.mode || '').toLowerCase();
                const mode = (modeParam === 'names') ? 'names' : 'codes';
                console.log(`[Export PDF] modeParam=${modeParam} resolved=${mode}, rows=${rows.length}, members=${members.length}`);
                const newestFirst = rows.map(t => {
                    const rawItem = t.item != null ? String(t.item).trim() : '';
                    let displayItem = rawItem;
                    if (mode === 'names' && codeToName[rawItem]) displayItem = codeToName[rawItem];
                    else if (mode === 'codes' && nameToCode[rawItem]) displayItem = nameToCode[rawItem];
                    return {
                        date: t.date,
                        subject: t.subject,
                        item: displayItem,
                        details: t.details || '',
                        amount: t.amount,
                        balance: t.balance
                    };
                }).reverse();
                const rowsHtml = newestFirst.map((t, idx) => `
                    <tr>
                        <td style="text-align:center;">${idx + 1}</td>
                        <td>${t.date || '-'}</td>
                        <td>${t.subject || '-'}</td>
                        <td>${t.item || '-'}</td>
                        <td>${t.details || '-'}</td>
                        <td dir="ltr" style="text-align:right;">${(typeof t.amount === 'number' ? t.amount.toFixed(3) : t.amount) || '0.000'}</td>
                        <td dir="ltr" style="text-align:right;">${(typeof t.balance === 'string' ? parseFloat(t.balance).toFixed(3) : (t.balance || 0)).toString()}</td>
                    </tr>
                `).join('');
                const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>تصدير PDF - جمعية الخطوة الأهلية</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 30px; color: #333; }
        h2 { margin-top: 0; color: #2c3e50; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #ddd; padding: 8px; white-space: normal; word-break: break-word; overflow-wrap: break-word; }
        th { background: #f2f6fa; color: #2c3e50; }
        .meta { margin-bottom: 10px; color: #666; font-size: 0.95rem; }
        @media print {
            .no-print { display: none; }
            body { margin: 0; }
        }
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom: 10px;">
        <button onclick="window.print()" style="padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#f7f7f7;cursor:pointer;">طباعة / حفظ PDF</button>
    </div>
    <h2>تقرير العمليات المالية</h2>
    <div class="meta">مرتب بالتاريخ من الأحدث للأقدم</div>
    <table>
        <colgroup>
            <col style="width:6%;">
            <col style="width:10%;">
            <col style="width:15%;">
            <col style="width:20%;">
            <col style="width:29%;">
            <col style="width:10%;">
            <col style="width:10%;">
        </colgroup>
        <thead>
            <tr>
                <th>التسلسل</th>
                <th>التاريخ</th>
                <th>الموضوع</th>
                <th>البند</th>
                <th>التفاصيل</th>
                <th>القيمة</th>
                <th>المجموع التراكمي</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
        </tbody>
    </table>
</body>
</html>`;
                res.send(html);
            });
        });
    });
});

// Save Info Message
app.post('/jam3ya/info-messages/save', requireJam3yaAdmin, (req, res) => {
    const { id, message, display_until } = req.body;
    
    if (id) {
        // Update
        jam3yaDb.run("UPDATE info_messages SET message = ?, display_until = ? WHERE id = ?", [message, display_until, id], (err) => {
            if (err) console.error("Info Message Update Error:", err);
            res.redirect('/jam3ya/dashboard?tab=info-messages');
        });
    } else {
        // Add
        jam3yaDb.run("INSERT INTO info_messages (message, display_until) VALUES (?, ?)", [message, display_until], (err) => {
            if (err) console.error("Info Message Add Error:", err);
            res.redirect('/jam3ya/dashboard?tab=info-messages');
        });
    }
});

// Delete Info Message
app.post('/jam3ya/info-messages/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run("DELETE FROM info_messages WHERE id = ?", [id], (err) => {
        if (err) console.error("Info Message Delete Error:", err);
        res.redirect('/jam3ya/dashboard?tab=info-messages');
    });
});

// Add/Update Member
app.post('/jam3ya/members/save', requireJam3yaAdmin, (req, res) => {
    const { id, member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin } = req.body;
    
    // Convert is_active checkbox to 1 or 0
    const isActiveVal = is_active ? 1 : 0;
    // Convert is_admin checkbox to 1 or 0
    const isAdminVal = is_admin ? 1 : 0;
    
    if (id) {
        // Update
        let sql = "UPDATE members SET member_code = ?, name = ?, nickname = ?, phone = ?, email = ?, is_active = ?, notes = ?, is_admin = ?";
        let params = [member_code, name, nickname, phone, email, isActiveVal, notes, isAdminVal];
        
        if (passcode && passcode.trim() !== '') {
            sql += ", passcode = ?";
            params.push(passcode);
        }
        
        sql += " WHERE id = ?";
        params.push(id);

        jam3yaDb.run(sql, params, (err) => {
            if (err) console.error(err);
            res.redirect('/jam3ya/dashboard?tab=members');
        });
    } else {
        // Add
        let finalPasscode = passcode;
        if (!finalPasscode) {
             const chars = 'abcdefghijklmnopqrstuvwxyz';
             let suffix = '';
             for (let i = 0; i < 2; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
             finalPasscode = (phone || '') + suffix;
        }

        // If member_code is provided, use it. If not, auto-increment.
        if (member_code && member_code.trim() !== '') {
            jam3yaDb.run("INSERT INTO members (member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                [member_code, name, nickname, phone, email, finalPasscode, isActiveVal, notes, isAdminVal], (err) => {
                if (err) console.error(err);
                res.redirect('/jam3ya/dashboard?tab=members');
            });
        } else {
            // Find max member_code
            // Assuming member_code is numeric string. We need to cast to integer for MAX()
            jam3yaDb.get("SELECT MAX(CAST(member_code AS INTEGER)) as maxCode FROM members", (err, row) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send("DB Error");
                }
                
                let nextCode = (row && row.maxCode) ? (row.maxCode + 1) : 1200; // Default start if empty? Or 1? Let's say 1200 based on existing data range.
                // Existing data seems to start around 1200.
                
                jam3yaDb.run("INSERT INTO members (member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                    [nextCode.toString(), name, nickname, phone, email, finalPasscode, isActiveVal, notes, isAdminVal], (err) => {
                    if (err) console.error(err);
                    res.redirect('/jam3ya/dashboard?tab=members');
                });
            });
        }
    }
});

// Delete Member
app.post('/jam3ya/members/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run("DELETE FROM members WHERE id = ?", [id], (err) => {
        if (err) console.error(err);
        res.redirect('/jam3ya/dashboard?tab=members');
    });
});

// Add Subject
app.post('/jam3ya/subjects/add', requireJam3yaAdmin, (req, res) => {
    const { name } = req.body;
    jam3yaDb.run("INSERT INTO subjects (name) VALUES (?)", [name], (err) => {
        if (err) console.error(err);
        res.redirect('/jam3ya/dashboard?tab=subjects');
    });
});

app.post('/jam3ya/obligations/add', requireJam3yaAdmin, (req, res) => {
    const { subject, description, notes, total_amount } = req.body;
    const amount = parseFloat(total_amount);

    if (!subject || isNaN(amount) || amount <= 0) {
        return res.status(400).send("Invalid obligation data");
    }

    let finalDescription = description || '';
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : '';
    if (trimmedNotes) {
        if (finalDescription) {
            finalDescription += '\n';
        }
        finalDescription += 'ملاحظات: ' + trimmedNotes;
    }

    jam3yaDb.run(
        "INSERT INTO obligations (subject, description, total_amount) VALUES (?, ?, ?)",
        [subject.trim(), finalDescription || null, amount],
        (err) => {
            if (err) {
                console.error("Obligation Insert Error:", err);
                return res.status(500).send("Error adding obligation");
            }
            res.redirect('/jam3ya/dashboard');
        }
    );
});

app.post('/jam3ya/obligations/edit', requireJam3yaAdmin, (req, res) => {
    const { id, subject, description, notes, total_amount } = req.body;
    const amount = parseFloat(total_amount);

    if (!id || !subject || isNaN(amount) || amount <= 0) {
        return res.status(400).send("Invalid obligation data");
    }

    let finalDescription = description || '';
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : '';
    if (trimmedNotes) {
        if (finalDescription) {
            finalDescription += '\n';
        }
        finalDescription += 'ملاحظات: ' + trimmedNotes;
    }

    jam3yaDb.run(
        "UPDATE obligations SET subject = ?, description = ?, total_amount = ? WHERE id = ?",
        [subject.trim(), finalDescription || null, amount, id],
        (err) => {
            if (err) {
                console.error("Obligation Update Error:", err);
                return res.status(500).send("Error updating obligation");
            }
            res.redirect('/jam3ya/dashboard');
        }
    );
});

// Edit Subject
app.post('/jam3ya/subjects/edit', requireJam3yaAdmin, (req, res) => {
    const { id, name, old_name } = req.body;
    
    // 1. Update subject name in subjects table
    jam3yaDb.run("UPDATE subjects SET name = ? WHERE id = ?", [name, id], (err) => {
        if (err) {
            console.error("Subject Update Error:", err);
            return res.status(500).send("Error updating subject");
        }

        // 2. Update transactions that used the old subject name
        if (old_name && old_name !== name) {
            jam3yaDb.run("UPDATE transactions SET subject = ? WHERE subject = ?", [name, old_name], (err) => {
                if (err) console.error("Transactions Subject Update Error:", err);
                // Continue even if transaction update fails (or just logs it)
                res.redirect('/jam3ya/dashboard?tab=subjects');
            });
        } else {
            res.redirect('/jam3ya/dashboard?tab=subjects');
        }
    });
});

// Delete Subject
app.post('/jam3ya/subjects/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run("DELETE FROM subjects WHERE id = ?", [id], (err) => {
        if (err) console.error(err);
        res.redirect('/jam3ya/dashboard?tab=subjects');
    });
});

// Manual Trigger Route
app.post('/jam3ya/reminders/send', requireJam3yaAdmin, async (req, res) => {
    try {
        if (!jam3yaDb) throw new Error("Database unavailable");
        await sendQuarterReminders();
        res.redirect('/jam3ya/dashboard?success=reminders_started&tab=unpaid');
    } catch (err) {
        console.error("Manual Reminder Error:", err);
        res.redirect('/jam3ya/dashboard?error=reminder_failed&tab=unpaid');
    }
});

*/

app.get('/login', (req, res) => res.render('login', { title: 'تسجيل الدخول', error: null }));
app.get('/register', (req, res) => res.render('register', { title: 'إنشاء حساب جديد', error: null }));

app.post('/register', async (req, res) => {
    try {
        const { name, email, phone, password, confirmPassword } = req.body;
        
        if (password !== confirmPassword) {
            return res.render('register', { title: 'إنشاء حساب جديد', error: 'كلمات المرور غير متطابقة' });
        }

        // التحقق من أن الإيميل غير مستخدم
        const [existingEmail] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail.length > 0) {
            return res.render('register', { title: 'إنشاء حساب جديد', error: 'البريد الإلكتروني مسجل مسبقًا' });
        }

        // التحقق من أن رقم الهاتف غير مستخدم
        const [existingPhone] = await pool.execute('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existingPhone.length > 0) {
            return res.render('register', { title: 'إنشاء حساب جديد', error: 'رقم الهاتف مسجل مسبقًا' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.execute('INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)', [name, email, phone, hashedPassword]);
        
        res.redirect('/login');

    } catch (error) {
        console.error("Register Error:", error);
        res.render('register', { title: 'إنشاء حساب جديد', error: 'حدث خطأ في الخادم' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const [rows] = await pool.execute('SELECT * FROM users WHERE phone = ?', [phone]);
        if (rows.length === 0) return res.render('login', { title: 'تسجيل الدخول', error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });

        const user = rows[0];

        // ======== بداية التحقق من الإيقاف ========
        if (user.is_suspended) {
            // إذا كان المستخدم موقوفًا، قم بتخزين معلوماته مؤقتًا في الجلسة
            // لإظهارها في صفحة الإيقاف
            req.session.suspended_user = {
                name: user.name,
                reason: user.suspension_reason || 'لم يتم تحديد سبب.'
            };
            return res.redirect('/suspended');
        }
        // ======== نهاية التحقق من الإيقاف ========

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.render('login', { title: 'تسجيل الدخول', error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });

       req.session.user = { id: user.id, name: user.name, is_admin: user.is_admin === 1, avatar: user.avatar };

        // تأكد من حذف أي بيانات مستخدم موقوف قديمة من الجلسة
        if (req.session.suspended_user) delete req.session.suspended_user;

        res.redirect('/');
    } catch (error) {
        console.error("Login Error:", error);
        res.render('login', { title: 'تسجيل الدخول', error: 'حدث خطأ في الخادم' });
    }
});
// مسار عرض صفحة إدارة المستخدمين
app.get('/admin/manage-users', requireAdmin, async (req, res) => {
    try {
        // جلب جميع المستخدمين مرتبين حسب تاريخ التسجيل
        const [users] = await pool.execute('SELECT id, name, email, phone, created_at, is_admin, is_suspended FROM users ORDER BY created_at DESC');
        
        res.render('manage-users', {
            title: 'إدارة المستخدمين',
            users: users
        });
    } catch (error) {
        console.error("Manage Users Page Error:", error);
        res.redirect('/admin'); // العودة لصفحة المدير الرئيسية في حالة الخطأ
    }
});
// =============================================================================
// مسارات إدارة المستخدمين (للمدير)
// =============================================================================
app.post('/admin/suspend-user/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'يجب تقديم سبب للإيقاف.' });
        
        await pool.execute(
            'UPDATE users SET is_suspended = 1, suspension_reason = ? WHERE id = ? AND is_admin = 0', // لا يمكن إيقاف مدير آخر
            [reason, id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

app.post('/admin/unsuspend-user/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute(
            'UPDATE users SET is_suspended = 0, suspension_reason = NULL WHERE id = ?',
            [id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});
app.get('/suspended', (req, res) => {
    if (!req.session.suspended_user) {
        return res.redirect('/login');
    }
    const { name, reason } = req.session.suspended_user;
    // مسح بيانات المستخدم من الجلسة بعد عرضها
    delete req.session.suspended_user;

    res.render('suspended', {
        title: 'الحساب موقوف',
        name,
        reason
    });
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

app.get('/add-product', requireAuth, async (req, res) => {
    const [categories] = await pool.execute("SELECT * FROM categories ORDER BY name");
    res.render('add-product', { title: 'إضافة منتج جديد', categories, error: null, success: null });
});

app.post('/add-product', requireAuth, upload.single('image'), async (req, res) => {
    const [categories] = await pool.execute("SELECT * FROM categories ORDER BY name");
    
    try {
        const title = req.body.title || null;
        const price = req.body.price || null;
        const userCategoryId = req.body.category_id || null;
        const product_condition = req.body.product_condition || 'used'; // إضافة حالة المنتج
        const description = req.body.description || null;
            const youtube_link = req.body.youtube_link || null; // <-- أضف السطر هنا

const compressedImageName = req.file ? await compressImage(req.file.buffer) : null;

        if (!title || !price || !userCategoryId) {
            return res.render('add-product', {
                title: 'إضافة منتج جديد',
                categories: categories,
                error: 'الرجاء ملء جميع الحقول الإلزامية.',
                success: null
            });
        }
        
        const [insertResult] = await pool.execute(
            'INSERT INTO products (user_id, title, price, product_condition, category_id, description, image_path,youtube_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.session.user.id, title, price, product_condition, userCategoryId, description, compressedImageName,youtube_link]
        );
        const newProductId = insertResult.insertId;

        res.render('add-product', {
            title: 'إضافة منتج جديد',
            categories: categories,
            error: null,
            success: 'تمت إضافة منتجك بنجاح! يعمل الذكاء الاصطناعي الآن على تحسين التصنيف...'
        });

        if (req.file) {
            getAIsuggestedCategory(title, description, req.file.buffer, req.file.mimetype)
                .then(async (aiResult) => {
                    if (aiResult && aiResult.categoryName) {
                        const [categoryRows] = await pool.execute('SELECT id FROM categories WHERE name = ?', [aiResult.categoryName]);
                        if (categoryRows.length > 0) {
                            const suggestedCategoryId = categoryRows[0].id;
                            if (suggestedCategoryId != userCategoryId) {
                                await pool.execute('UPDATE products SET category_id = ? WHERE id = ?', [suggestedCategoryId, newProductId]);
                                console.log(`Google AI Corrected Product ${newProductId} to AICategory ${suggestedCategoryId}`);
                            }
                        }
                    }
                })
                .catch(error => {
                    console.error("Google AI background process failed:", error.message);
                });
        }

    } catch (error) {
        console.error("Add Product Error:", error);
        res.render('add-product', {
            title: 'إضافة منتج جديد',
            categories: categories,
            error: 'حدث خطأ غير متوقع أثناء إضافة المنتج.',
            success: null
        });
    }
});

app.get('/add-product', requireAuth, async (req, res) => {
    try {
        const [categories] = await pool.execute("SELECT * FROM categories ORDER BY name");
        res.render('add-product', {
            title: 'إضافة منتج جديد',
            categories: categories,
            error: null,
            success: null
        });
    } catch (error) {
        console.error("Get Add Product Page Error:", error);
        res.status(500).send("Server Error"); // إرسال خطأ 500 بدلاً من إعادة التوجيه
    }
});
// =============================================================================
// مسار عرض صفحة تعديل المنتج (GET request)
// =============================================================================
app.get('/edit-product/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;

        let query;
        let params;

        // التحقق مما إذا كان المستخدم مديرًا
        if (user && user.is_admin) {
            // المدير: يمكنه جلب أي منتج لتعديله
            query = 'SELECT * FROM products WHERE id = ?';
            params = [id];
        } else {
            // المستخدم العادي: يمكنه جلب منتجاته فقط
            query = 'SELECT * FROM products WHERE id = ? AND user_id = ?';
            params = [id, user.id];
        }
        
        const [productRows] = await pool.execute(query, params);

        // إذا لم يتم العثور على المنتج أو كان لا يملكه المستخدم، قم بإعادة التوجيه
        if (productRows.length === 0) {
            return res.redirect('/my-products');
        }
        
        const product = productRows[0];
        // نضبط اسم الحقل ليتوافق مع النموذج
        product.name = product.title;

        // جلب قائمة التصنيفات لملء القائمة المنسدلة
        const [categories] = await pool.execute('SELECT * FROM categories ORDER BY name');
        
        res.render('edit-product', {
            title: `تعديل: ${product.title}`,
            product: product,
            categories: categories,
            error: null,
            success: null
        });

    } catch (error) {
        console.error("Get Edit Product Page Error:", error);
        res.redirect('/my-products'); // العودة لصفحة المنتجات في حالة حدوث خطأ
    }
});
app.post('/edit-product/:id', requireAuth, upload.single('image'), async (req, res) => {
    const productId = req.params.id;
    try {
        // قراءة البيانات من النموذج بأمان
        const { name: title, price, product_condition, category_id, description, youtube_link } = req.body;

        // التحقق من وجود المنتج وأنه يخص المستخدم
        const [productRows] = await pool.execute('SELECT image_path FROM products WHERE id = ? AND user_id = ?', [productId, req.session.user.id]);
        if (productRows.length === 0) {
            return res.redirect('/my-products');
        }
        
        let image_path = productRows[0].image_path; // المسار القديم للصورة

        // السيناريو المطلوب: إذا تم رفع صورة جديدة، احذف القديمة
        if (req.file) {
            // ضغط الصورة الجديدة
const newImageName = await compressImage(req.file.buffer);
            
            if (newImageName) {
                // إذا كانت هناك صورة قديمة، قم بحذفها الآن
                if (image_path) {
                    await fs.unlink(path.join(__dirname, 'uploads', image_path)).catch(e => console.error("Failed to delete old image:", e.message));
                }
                // قم بتعيين اسم الصورة الجديدة ليكون هو المسار الذي سيتم حفظه
                image_path = newImageName;
            }
        }

        // تحديث قاعدة البيانات بالمعلومات الجديدة (سواء تم تغيير الصورة أم لا)
        await pool.execute(
            'UPDATE products SET title = ?, price = ?, product_condition = ?, category_id = ?, description = ?, image_path = ? , youtube_link = ?  WHERE id = ? AND user_id = ?',
            [title, price, product_condition, category_id, description, image_path,youtube_link, productId, req.session.user.id]
        );
        
        // أعد توجيه المستخدم إلى صفحة منتجاتي بعد النجاح
        res.redirect('/my-products');

    } catch (error) {
        // التعامل مع أي أخطاء (بما في ذلك MulterError)
        console.error("Post Edit Product Error:", error);
        res.redirect(`/edit-product/${productId}?error=true`);
    }
});

app.get('/my-products', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;

        // استعلام أساسي لجلب كل البيانات التي نحتاجها
        let query = `
            SELECT 
                p.*, 
                p.title as name, 
                c.name as category_name,
                u.name as owner_name 
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id
            JOIN users u ON p.user_id = u.id
        `;
        const params = [];

        // التحقق مما إذا كان المستخدم مديرًا
        if (user && user.is_admin) {
            // المدير: لا توجد شروط إضافية، اعرض كل شيء
        } else {
            // المستخدم العادي: أضف شرطًا لعرض منتجاته فقط
            query += ' WHERE p.user_id = ?';
            params.push(user.id);
        }

        query += ' ORDER BY p.created_at DESC';

        const [products] = await pool.execute(query, params);

        res.render('my-products', {
            title: user.is_admin ? 'إدارة جميع المنتجات' : 'منتجاتي',
            products: products,
            req: req // نمرر req كما كان سابقاً
        });

    } catch (e) {
        console.error("My Products Page Error:", e);
        res.redirect('/');
    }
});

app.get('/profile', requireAuth, async (req, res) => {
    try {
        const [userRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const [[stats]] = await pool.execute(`SELECT COUNT(*) as totalProducts, SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as availableProducts, SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as soldProducts FROM products WHERE user_id = ?`, [req.session.user.id]);
        const [recentProducts] = await pool.execute('SELECT title, price, status, image_path FROM products WHERE user_id = ? ORDER BY created_at DESC LIMIT 3', [req.session.user.id]);
        res.render('profile', { title: 'الملف الشخصي', user: userRows[0], stats, recentProducts });
    } catch (e) {
        res.redirect('/');
    }
});

app.get('/edit-profile', requireAuth, async (req, res) => {
    const [userRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    res.render('edit-profile', { title: 'تعديل الملف الشخصي', user: userRows[0], error: null, success: null });
});

app.post('/edit-profile', requireAuth, upload.single('avatar'), async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { name, email, bio } = req.body;
        const [userRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        let user = userRows[0];
        let avatarPath = user.avatar;

        if (req.file) {
            const newAvatarName = await compressImage(req.file.buffer);
            if (newAvatarName) {
                if (avatarPath) await fs.unlink(path.join(__dirname, 'uploads', avatarPath)).catch(e => console.log("Old avatar not found."));
                avatarPath = newAvatarName;
            }
        }
        await pool.execute(
            'UPDATE users SET name = ?, email = ?, bio = ?, avatar = ? WHERE id = ?',
            [name, email, bio, avatarPath, userId]
        );
        res.redirect('/profile');
    } catch (error) {
        console.error("Edit Profile Error:", error);
        res.redirect('/edit-profile?error=true');
    }
});

app.post('/update-product-status', requireAuth, async (req, res) => {
    try {
        const { productId, status } = req.body;
        const user = req.session.user;

        if (!['available', 'sold'].includes(status)) {
            return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
        }

        let query;
        let params;

        // التحقق مما إذا كان المستخدم مديرًا
        if (user && user.is_admin) {
            // المدير: يمكنه تحديث أي منتج
            query = 'UPDATE products SET status = ? WHERE id = ?';
            params = [status, productId];
        } else {
            // المستخدم العادي: يمكنه تحديث منتجاته فقط
            query = 'UPDATE products SET status = ? WHERE id = ? AND user_id = ?';
            params = [status, productId, user.id];
        }

        const [result] = await pool.execute(query, params);

        // التحقق مما إذا كان قد تم تحديث أي صف
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'تم تحديث الحالة بنجاح' });
        } else {
            // يحدث هذا إذا حاول مستخدم عادي تحديث منتج لا يملكه
            res.status(403).json({ success: false, message: 'غير مصرح لك بتحديث هذا المنتج' });
        }

    } catch (error) {
        console.error("Update Status Error:", error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// =============================================================================
// مسارات التحكم الخاصة بالمدير (إخفاء، إظهار، حذف)
// =============================================================================

// مسار إخفاء منتج
// مسار إخفاء منتج (مُحسَّن)
app.post('/admin/hide-product/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body; // سنتلقى السبب من الواجهة الأمامية

        if (!reason || reason.trim() === '') {
            return res.status(400).json({ success: false, message: 'يجب تقديم سبب للإخفاء.' });
        }

        await pool.execute(
            'UPDATE products SET admin_hidden = 1, admin_hide_reason = ? WHERE id = ?',
            [reason, id]
        );
        res.json({ success: true, message: 'تم إخفاء المنتج بنجاح' });
    } catch (error) {
        console.error("Admin Hide Product Error:", error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// مسار إظهار منتج
// مسار إظهار منتج (مُحسَّن)
app.post('/admin/show-product/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute(
            'UPDATE products SET admin_hidden = 0, admin_hide_reason = NULL WHERE id = ?',
            [id]
        );
        res.json({ success: true, message: 'تم إظهار المنتج بنجاح' });
    } catch (error) {
        console.error("Admin Show Product Error:", error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// مسار حذف منتج (بواسطة المدير)
app.post('/admin/delete-product/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // أولاً، جلب مسار الصورة لحذفها من الخادم
        const [productRows] = await pool.execute('SELECT image_path FROM products WHERE id = ?', [id]);

        if (productRows.length > 0 && productRows[0].image_path) {
            const image_path = productRows[0].image_path;
            await fs.unlink(path.join(__dirname, 'uploads', image_path)).catch(e => console.error("Failed to delete product image (admin):", e.message));
        }

        // ثانياً، حذف المنتج من قاعدة البيانات
        await pool.execute('DELETE FROM products WHERE id = ?', [id]);

        res.json({ success: true, message: 'تم حذف المنتج نهائياً' });
    } catch (error) {
        console.error("Admin Delete Product Error:", error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

app.post('/delete-product-image', requireAuth, async (req, res) => {
    try {
        const { productId, imagePath } = req.body;
        const userId = req.session.user.id;
        const [productRows] = await pool.execute('SELECT user_id FROM products WHERE id = ?', [productId]);
        if (productRows.length === 0 || productRows[0].user_id !== userId) return res.status(403).json({ success: false, message: 'غير مصرح لك' });
        await pool.execute('UPDATE products SET image_path = NULL WHERE id = ?', [productId]);
        if (imagePath) await fs.unlink(path.join(__dirname, 'uploads', imagePath)).catch(err => { console.error(`Optional: Failed to delete image file: ${imagePath}`, err.message); });
        res.json({ success: true, message: 'تم حذف الصورة بنجاح' });
    } catch (error) {
        console.error("Delete Product Image Error:", error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// =============================================================================
// مسار حذف المنتج (للمستخدم العادي)
// =============================================================================
app.post('/delete-product', requireAuth, async (req, res) => {
    try {
        const { productId } = req.body;
        const userId = req.session.user.id;

        // التحقق من أن المنتج موجود وأن المستخدم الحالي هو المالك
        const [productRows] = await pool.execute(
            'SELECT image_path FROM products WHERE id = ? AND user_id = ?',
            [productId, userId]
        );

        if (productRows.length === 0) {
            // إذا لم يتم العثور على المنتج أو كان لا يملكه المستخدم، أرجع خطأ
            return res.status(403).json({ success: false, message: 'غير مصرح لك بحذف هذا المنتج' });
        }

        // حذف الصورة المرتبطة بالمنتج من مجلد "uploads" (إن وجدت)
        const image_path = productRows[0].image_path;
        if (image_path) {
            await fs.unlink(path.join(__dirname, 'uploads', image_path)).catch(e => console.error("Failed to delete product image:", e.message));
        }

        // حذف سجل المنتج من قاعدة البيانات
        await pool.execute(
            'DELETE FROM products WHERE id = ? AND user_id = ?',
            [productId, userId]
        );

        // إرسال رد نجاح بصيغة JSON
        res.json({ success: true, message: 'تم حذف المنتج بنجاح' });

    } catch (error) {
        console.error("Delete Product Error:", error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم أثناء محاولة الحذف' });
    }
});
app.get('/admin', requireAdmin, async (req, res) => {
    try {
        const [[{ users }]] = await pool.execute("SELECT COUNT(*) as users FROM users");
        const [[{ products }]] = await pool.execute("SELECT COUNT(*) as products FROM products");
        const [[{ available }]] = await pool.execute("SELECT COUNT(*) as available FROM products WHERE status = 'available'");
        const [allProducts] = await pool.execute(`SELECT p.*, p.title as name, u.name as user_name FROM products p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`);
        
        // <-- جلب التصنيفات هنا
        const [categories] = await pool.execute('SELECT * FROM categories ORDER BY name ASC');

        res.render('admin', {
            title: 'لوحة التحكم',
            stats: { users, products, available },
            products: allProducts,
            categories: categories // <-- تمرير التصنيفات إلى الصفحة
        });
    } catch (e) {
        res.redirect('/');
    }
});

app.get('/get-admin-whatsapp', (req, res) => {
    if (process.env.WHATSAPP_PHONE_ID) {
        res.json({ success: true, number: process.env.WHATSAPP_PHONE_ID });
    } else {
        res.status(404).json({ success: false, message: 'رقم الإدارة غير محدد' });
    }
});
// =============================================================================
// مسارات استعادة كلمة المرور
// =============================================================================

// 1. عرض صفحة "نسيت كلمة المرور"
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { title: 'استعادة كلمة المرور', error: null, success: null });
});

// 2. معالجة طلب استعادة كلمة المرور
app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const [userRows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);

        if (userRows.length === 0) {
            // نعرض رسالة نجاح حتى لو لم نجد الإيميل، لمنع كشف المستخدمين المسجلين
            return res.render('forgot-password', { title: 'استعادة كلمة المرور', error: null, success: 'إذا كان بريدك الإلكتروني مسجلاً لدينا، فستتلقى رابطاً لإعادة التعيين.' });
        }
        const user = userRows[0];

        // إنشاء رمز عشوائي وآمن
        const token = crypto.randomBytes(20).toString('hex');
        // تحديد تاريخ انتهاء صلاحية الرمز (ساعة واحدة من الآن)
        const expires = new Date(Date.now() + 3600000); // 1 hour

        await pool.execute(
            'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
            [token, expires, user.id]
        );

        const resetLink = `http://${req.headers.host}/reset/${token}`;

        const mailOptions = {
           from: `"دكان الحجور" <${process.env.MAIL_USER}>`,
            to: user.email,
            subject: 'إعادة تعيين كلمة المرور لحسابك في دكان الحجور',
            html: `
                <p>أهلاً ${user.name},</p>
                <p>لقد طلبت إعادة تعيين كلمة المرور الخاصة بك.</p>
                <p>الرجاء الضغط على الرابط التالي (أو نسخه ولصقه في متصفحك) لإكمال العملية:</p>
                <a href="${resetLink}">${resetLink}</a>
                <p>هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
                <p>إذا لم تطلب هذا الإجراء، فالرجاء تجاهل هذا البريد الإلكتروني.</p>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.render('forgot-password', { title: 'استعادة كلمة المرور', error: null, success: 'تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني بنجاح.' });

    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.render('forgot-password', { title: 'استعادة كلمة المرور', error: 'حدث خطأ ما، يرجى المحاولة مرة أخرى.', success: null });
    }
});

// 3. عرض صفحة إعادة تعيين كلمة المرور
app.get('/reset/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const [userRows] = await pool.execute(
            'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
            [token]
        );

        if (userRows.length === 0) {
            // إذا كان الرمز غير صالح أو منتهي الصلاحية
            return res.render('forgot-password', { title: 'استعادة كلمة المرور', error: 'رابط إعادة تعيين كلمة المرور غير صالح أو انتهت صلاحيته.', success: null });
        }

        res.render('reset-password', { title: 'إعادة تعيين كلمة المرور', token, error: null });
    } catch (error) {
        console.error('Reset GET Error:', error);
        res.redirect('/forgot-password');
    }
});

// 4. معالجة إعادة تعيين كلمة المرور
app.post('/reset/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            return res.render('reset-password', { title: 'إعادة تعيين كلمة المرور', token, error: 'كلمات المرور غير متطابقة.' });
        }

        const [userRows] = await pool.execute(
            'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
            [token]
        );

        if (userRows.length === 0) {
            return res.render('forgot-password', { title: 'استعادة كلمة المرور', error: 'رابط إعادة تعيين كلمة المرور غير صالح أو انتهت صلاحيته.', success: null });
        }
        const user = userRows[0];

        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.execute(
            'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );

        // يمكنك هنا تسجيل دخول المستخدم تلقائياً أو توجيهه لصفحة تسجيل الدخول
        res.redirect('/login');

    } catch (error) {
        console.error('Reset POST Error:', error);
        res.render('reset-password', { title: 'إعادة تعيين كلمة المرور', token, error: 'حدث خطأ ما، يرجى المحاولة مرة أخرى.' });
    }
});

// =============================================================================
// مسار السوق (يعرض منتجات جميع المستخدمين باستثناء الدكان الرئيسي)
// =============================================================================
app.get('/market', async (req, res) => {
    try {
        // 1. ابحث عن ID المستخدم المحدد كـ "الدكان الرئيسي"
        const [mainUserRows] = await pool.execute('SELECT id FROM users WHERE is_main_store = 1 LIMIT 1');
        const mainUserId = mainUserRows.length > 0 ? mainUserRows[0].id : null;

        // 2. جلب منتجات جميع المستخدمين الآخرين
        const categoryId = req.query.category;
        let query = `
            SELECT p.*, p.title as name, u.name as seller_name, u.phone as seller_phone, c.name as category_name
            FROM products p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status = 'available' AND p.admin_hidden = 0
        `;
        const params = [];

        // إذا وجدنا مستخدمًا رئيسيًا، استبعد منتجاته
        if (mainUserId) {
            query += ' AND p.user_id != ?';
            params.push(mainUserId);
        }

        // تطبيق فلتر التصنيف إذا كان موجودًا
        if (categoryId && categoryId !== 'all') {
            query += ' AND p.category_id = ?';
            params.push(categoryId);
        }
        query += ' ORDER BY p.created_at DESC';

        const [products] = await pool.execute(query, params);
        
        // جلب قائمة التصنيفات التي تحتوي على منتجات في السوق فقط
        let categoriesQuery = 'SELECT * FROM categories WHERE id IN (SELECT DISTINCT category_id FROM products WHERE status = "available" AND admin_hidden = 0';
        const catParams = [];
        if(mainUserId) {
            categoriesQuery += ' AND user_id != ?';
            catParams.push(mainUserId);
        }
        categoriesQuery += ') ORDER BY name ASC';
        const [categories] = await pool.execute(categoriesQuery, catParams);
        
        // 3. سنقوم بإعادة استخدام نفس صفحة index.ejs لعرض النتائج
     res.render('index', {
    title: 'تصفح السوق',
    products,
    categories,
    selectedCategory: categoryId || 'all',
    req: req,
    isMarketPage: true,
    mainUser: null // <-- أضف هذا السطر
});

    } catch (error) {
        console.error("Market Page Error:", error);
        res.status(500).send("Server Error");
    }
});
// =============================================================================
// مسارات الدكاكين
// =============================================================================

// 1. مسار عرض قائمة جميع الدكاكين
app.get('/dukkanlar', async (req, res) => {
    try {
        // جلب المستخدمين الذين لديهم منتج واحد على الأقل، مع عدد منتجاتهم
        const [dukkanlar] = await pool.execute(`
            SELECT u.id, u.name, u.avatar, COUNT(p.id) as product_count
            FROM users u
            JOIN products p ON u.id = p.user_id
            WHERE p.status = 'available' AND p.admin_hidden = 0
            GROUP BY u.id, u.name, u.avatar
            HAVING product_count > 0
            ORDER BY u.name ASC;
        `);

        res.render('dukkanlar-list', {
            title: 'قائمة الدكاكين',
            dukkanlar: dukkanlar
        });
    } catch (error) {
        console.error("Dukkan list page error:", error);
        res.redirect('/');
    }
});

// 2. مسار عرض صفحة دكان فردي
app.get('/dukan/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // جلب معلومات صاحب الدكان (المستخدم)
        const [userRows] = await pool.execute('SELECT id, name, avatar, bio, created_at, phone FROM users WHERE id = ?', [userId]);

        if (userRows.length === 0) {
            return res.redirect('/dukkanlar'); // إذا لم يتم العثور على المستخدم
        }
        const dukanOwner = userRows[0];

        // جلب جميع منتجات هذا المستخدم المتاحة
       const [products] = await pool.execute(`
    SELECT 
        p.*, 
        p.title as name, 
        c.name as category_name 
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.user_id = ? AND p.status = 'available' AND p.admin_hidden = 0 
    ORDER BY p.created_at DESC
`, [userId]);

        res.render('dukan-single', {
            title: `دكان ${dukanOwner.name}`,
            owner: dukanOwner,
            products: products,
            req: req 
        });

    } catch (error) {
        console.error("Single dukan page error:", error);
        res.redirect('/');
    }
});

// =============================================================================
// مسارات API لإدارة التصنيفات (للمدير)
// =============================================================================

// إضافة تصنيف جديد
app.post('/admin/categories', requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ success: false, message: 'اسم التصنيف مطلوب.' });
        }
        const [result] = await pool.execute('INSERT INTO categories (name) VALUES (?)', [name.trim()]);
        res.json({ success: true, id: result.insertId, name: name.trim() });
    } catch (error) {
        console.error("Add Category Error:", error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم.' });
    }
});

// تعديل تصنيف موجود
app.put('/admin/categories/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ success: false, message: 'اسم التصنيف مطلوب.' });
        }
        await pool.execute('UPDATE categories SET name = ? WHERE id = ?', [name.trim(), id]);
        res.json({ success: true, message: 'تم تحديث التصنيف بنجاح.' });
    } catch (error) {
        console.error("Update Category Error:", error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم.' });
    }
});

// حذف تصنيف
app.delete('/admin/categories/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // ملاحظة: عند حذف تصنيف، المنتجات المرتبطة به سيصبح category_id الخاص بها NULL
        // بسبب إعداد ON DELETE SET NULL في قاعدة البيانات.
        await pool.execute('DELETE FROM categories WHERE id = ?', [id]);
        res.json({ success: true, message: 'تم حذف التصنيف بنجاح.' });
    } catch (error) {
        console.error("Delete Category Error:", error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم.' });
    }
});

/////////////////////////////////////////////////GPT PART START////
app.post('/chat', async (req, res) => {
  try {
    await runSequence(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api', (req, res) => {
  res.json('jam3ya-gpt is up');
});

async function askQuestion(req, res) {
  let url =
    `https://dbc-780790af-3e53.cloud.databricks.com/api/2.0/genie/spaces/` + process.env.GPT_SPACE_ID;

  if (req.body.conversationId === '') {
    url += `/start-conversation`;
  } else {
    url += `/conversations/` + req.body.conversationId + `/messages`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TOKEN}`
    },
    body: JSON.stringify({
      content: String(req.body.message)
    })
  });

  return response.json();
}

async function getAnswer(dataFrom1) {
  while (true) {
    const response = await fetch(
      `https://dbc-780790af-3e53.cloud.databricks.com/api/2.0/genie/spaces/${dataFrom1.space_id}/conversations/${dataFrom1.conversation_id}/messages/${dataFrom1.message_id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.TOKEN}`
        }
      }
    );

    const data = await response.json();
    if (data.status === 'COMPLETED' || data.status === 'FAILED') {
      return data;
    }

    await new Promise(r => setTimeout(r, 100));
  }
}

async function getSqlData(statementId) {
  while (true) {
    const response = await fetch(
      `https://dbc-780790af-3e53.cloud.databricks.com/api/2.0/sql/statements/${statementId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.TOKEN}`
        }
      }
    );

    const data = await response.json();
    if (data.status.state === 'SUCCEEDED') return data;

    await new Promise(r => setTimeout(r, 100));
  }
}

async function runSequence(req, res) {
  const serverResponse = new ServerResponse();

  let result1 = await askQuestion(req, res);
  if (result1?.message) result1 = result1.message;

  const result2 = await getAnswer(result1);
  
  const attachments = result2.attachments || [];

  const desc = attachments.find(a => a.query?.description);
  if (desc) serverResponse.sqlDes = desc.query.description;

  const textWithoutId = attachments.filter(a => a?.text?.content && !a?.attachment_id).map(a => a.text.content);

  let textWithId =[];  
  textWithId = attachments
  .filter(a => a?.text?.content && a?.attachment_id).map(a => ({
    id: a.attachment_id,
    content: a.text.content
  }));

  if(result2.status === 'COMPLETED')
    serverResponse.content = textWithoutId;
  else
    serverResponse.content = ['أرجو إعادة صياغة السؤال.'];

  if(textWithId.length > 0)
    serverResponse.contentQues = textWithId[0].content;

  const suggested = attachments.find(a => a.suggested_questions);
  if (suggested)
    serverResponse.suggestedQuestions = suggested.suggested_questions.questions;

  const sql = attachments.find(a => a.query?.statement_id);
  if (sql && result2.status === 'COMPLETED') {
    serverResponse.table = await getSqlData(sql.query.statement_id);
  }

  serverResponse.created_timestamp = new Date(
    result2.created_timestamp
  ).toLocaleTimeString('en-US', { timeZone: 'Asia/Muscat' });

  serverResponse.conversation_id = result2.conversation_id;
  serverResponse.message_id = result2.message_id;

  res.json({ reply: serverResponse });
}

class ServerResponse {
  created_timestamp;
  conversation_id;
  message_id;
  content;
  contentQues;
  sqlDes;
  suggestedQuestions;
  table;
}
/////////////////////////////////////////////////GPT PART END//////

// معالج 404
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});

const PORT = process.env.PORT || 3000;

// Add CSP middleware globally before starting the server
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' data: https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*; frame-src 'self';"
    );
    next();
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT}`);
});

module.exports = app;
