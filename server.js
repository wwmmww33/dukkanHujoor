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
const Jam3yaMySQLAdapter = require('./jam3ya-mysql-adapter');

// Function to attempt MySQL connection (Fallback)
const tryMysqlFallback = () => {
    if (process.env.NODE_ENV === 'production') {
        console.log("Attempting MySQL fallback for Jam3ya...");
        try {
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
    
    // Only if MySQL fails, we might want to consider SQLite, but for now we enforce MySQL as primary.
} else if (sqlite3) {
    // In Development: Prefer SQLite if available (for local testing)
    // Default to local file if JAM3YA_DB_NAME is not a file path
    const dbName = process.env.JAM3YA_DB_NAME || '';
    const dbPath = dbName.endsWith('.sqlite') 
        ? dbName 
        : path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');

    if (!require('fs').existsSync(dbPath)) {
        console.warn("Jam3ya SQLite file not found at:", dbPath);
        jam3yaDbError = "ملف قاعدة البيانات غير موجود في المسار المتوقع:<br>" + dbPath + "<br>يرجى التأكد من رفع الملف بالاسم الصحيح.";
        jam3yaDb = null;
    } else {
        jam3yaDb = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Could not connect to Jam3ya database:', err);
                jam3yaDbError = "SQLite Connection Failed: " + err.message;
                jam3yaDb = null;
            } else {
                console.log('Connected to Jam3ya database (SQLite) at ' + dbPath);
                jam3yaDb.run("ALTER TABLE members ADD COLUMN nickname TEXT", (err) => {});
                jam3yaDb.run("ALTER TABLE members ADD COLUMN email TEXT", (err) => {});
                // Ensure approval workflow columns exist on transactions
                jam3yaDb.run("ALTER TABLE transactions ADD COLUMN is_approved INTEGER DEFAULT 1", (err) => {});
                jam3yaDb.run("ALTER TABLE transactions ADD COLUMN created_by_member INTEGER DEFAULT 0", (err) => {});
                jam3yaDb.run("CREATE TABLE IF NOT EXISTS visitors (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, path TEXT, date TEXT, user_agent TEXT, member_name TEXT)", (err) => {
                    // Try to add member_name column if table exists but column doesn't
                    if (!err) {
                        jam3yaDb.run("ALTER TABLE visitors ADD COLUMN member_name TEXT", (e) => {});
                    }
                });
            }
        });
    }
} else {
    console.log("Skipping Jam3ya DB connection (Not production and no sqlite3).");
    if (!jam3yaDbError) jam3yaDbError = "SQLite3 module missing or disabled";
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

// Helper for logging visitors
const logVisitor = (req, memberName) => {
    if (!jam3yaDb) return;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const path = req.originalUrl; // Will show /jam3ya/login or /jam3ya/login/confirm
    const ua = req.get('User-Agent') || '';
    const date = new Date().toISOString();
    
    jam3yaDb.run("INSERT INTO visitors (ip, path, date, user_agent, member_name) VALUES (?, ?, ?, ?, ?)", 
        [ip, path, date, ua, memberName], (err) => {
        if (err) console.error("Visitor Log Error:", err.message);
    });
};

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
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST, // <-- تم التعديل
    port: process.env.MAIL_PORT, // <-- تم التعديل
    secure: true,
    auth: {
        user: process.env.MAIL_USER, // <-- تم التعديل
        pass: process.env.MAIL_PASS, // <-- تم التعديل
    },
});

async function getUnpaidMembersEmailsForYear(year) {
    return new Promise((resolve, reject) => {
        if (!jam3yaDb) return reject(new Error('Jam3ya DB unavailable'));
        jam3yaDb.serialize(() => {
            jam3yaDb.all("SELECT id, member_code, name, email, is_active, passcode FROM members", (mErr, members) => {
                if (mErr) return reject(mErr);
                const activeWithEmail = (members || []).filter(m => (m.is_active == 1 || m.is_active == null) && m.email && m.email.trim() !== '');
                const targetCodes = new Set(activeWithEmail.map(m => String(m.member_code || '').trim()));
                jam3yaDb.all("SELECT item, date, details, subject, is_approved FROM transactions WHERE subject = 'مساهمات الاعضاء' AND is_approved = 1", (tErr, rows) => {
                    if (tErr) return reject(tErr);
                    const paid = new Set();
                    (rows || []).forEach(r => {
                        const item = String(r.item || '').trim();
                        const details = String(r.details || '');
                        const dateStr = String(r.date || '');
                        let isPaid = false;
                        const years = (details.match(/\d{4}/g) || []);
                        if (years.includes(String(year))) isPaid = true;
                        else if (dateStr.startsWith(String(year))) isPaid = true;
                        if (isPaid) paid.add(item);
                    });
                    const unpaid = activeWithEmail.filter(m => !paid.has(String(m.member_code || '').trim()));
                    resolve(unpaid);
                });
            });
        });
    });
}

async function sendQuarterReminders() {
    try {
        const currentYear = new Date().getFullYear();
        const list = await getUnpaidMembersEmailsForYear(currentYear);
        for (const m of list) {
            const to = String(m.email).trim();
            if (!to) continue;
            await transporter.sendMail({
                from: `"جمعية الخطوة الأهلية" <${process.env.MAIL_USER}>`,
                to,
                subject: `جمعية الخطوة الأهلية (تذكير)`,
                html: `
                    <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; line-height: 1.7; color: #333;">
                        <h2 style="color: #2c3e50;">جمعية الخطوة الأهلية</h2>
                        <hr style="border: 1px solid #eee;">
                        <p>مرحباً ${m.name}،</p>
                        <p>هذا تذكير ودي بالمساهمة السنوية عن سنة <strong>${currentYear}</strong>، حيث يظهر لدينا أنك لم تسدد حتى الآن.</p>
                        <p>نرجو المبادرة بالسداد جزاكم الله خيراً.</p>
                        <br>
                        <p>
                            لمزيد من التفاصيل، يمكنكم زيارة صفحة الجمعية:<br>
                            <a href="${process.env.BASE_URL || 'http://localhost:3000'}/jam3ya" style="display: inline-block; background-color: #27ae60; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">
                                الذهاب لصفحة الجمعية
                            </a>
                        </p>
                        <p style="background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px dashed #ccc; display: inline-block;">
                            <strong>الرمز السري الخاص بك:</strong> <span style="font-family: monospace; font-size: 1.2em; color: #c0392b;">${m.passcode || '---'}</span>
                        </p>
                        <br>
                        <p style="color: #777; font-size: 0.9em;">مع التحيات،<br>إدارة جمعية الخطوة الأهلية</p>
                    </div>
                `
            });
        }
    } catch (e) {
        console.error("Quarter reminder error:", e);
    }
}

function getNextReminderDate() {
    const now = new Date();
    const months = [2, 5, 8, 11];
    for (let i = 0; i < months.length; i++) {
        const d = new Date(now.getFullYear(), months[i], 23, 19, 0, 0, 0);
        if (d.getTime() > now.getTime()) return d;
    }
    return new Date(now.getFullYear() + 1, months[0], 23, 19, 0, 0, 0);
}

function scheduleNextReminder() {
    const next = getNextReminderDate();
    const now = Date.now();
    const delay = Math.max(0, next.getTime() - now);
    const MAX_DELAY = 2147483647; // ~24.8 days

    if (delay > MAX_DELAY) {
        console.log(`Next reminder is in future. Waiting...`);
        setTimeout(scheduleNextReminder, MAX_DELAY);
    } else {
        console.log(`Scheduling reminder in ${delay}ms`);
        setTimeout(async () => {
            await sendQuarterReminders();
            scheduleNextReminder();
        }, delay);
    }
}

if (process.env.JAM3YA_REMINDERS_ENABLED === 'true') {
    scheduleNextReminder();
}

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

// Jam3ya Helper Middleware
const checkJam3yaDb = (req, res, next) => {
    // Check if Jam3ya DB is null OR if it has an initialization error (for MySQL adapter)
    if (!jam3yaDb || (jam3yaDb.initializationError)) {
        // Try to initialize Jam3ya DB again (fallback attempt)
        if (process.env.NODE_ENV === 'production' && mysql) {
            // Check if we can fallback to MySQL for Jam3ya
            // Note: This assumes tables exist in MySQL.
            // For now, we just return 503 if sqlite failed.
        }

        const errorMsg = jam3yaDb && jam3yaDb.initializationError 
            ? jam3yaDb.initializationError.message || jam3yaDb.initializationError
            : jam3yaDbError;

        // Debug: Check password length and Host
        const passLen = process.env.JAM3YA_DB_PASSWORD ? process.env.JAM3YA_DB_PASSWORD.length : 'N/A';
        const dbHost = process.env.JAM3YA_DB_HOST || 'localhost (default)';
        const debugInfo = `User: ${process.env.JAM3YA_DB_USER} | DB: ${process.env.JAM3YA_DB_NAME} | Host: ${dbHost} | PassLen: ${passLen}`;

        if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
            return res.status(503).json({ success: false, message: 'Jam3ya service unavailable (DB connection failed)' });
        }

        let hint = "";
        if (errorMsg && errorMsg.includes('to database')) {
             hint = '<strong>Diagnosis:</strong> Password is CORRECT, but the User has no permissions.<br><strong>Fix:</strong> Go to cPanel -> MySQL Databases -> Add User to Database -> Select User & DB -> Add -> <strong>CHECK ALL PRIVILEGES</strong> -> Make Changes.';
        } else if (errorMsg && errorMsg.includes('Access denied')) {
             hint = '<strong>Diagnosis:</strong> Wrong Password or User does not exist.<br><strong>Fix:</strong> Check .env password matches cPanel password exactly.';
        }

        return res.status(503).send(`
            <div style="text-align:center; padding:50px; font-family:sans-serif;">
                <h1>عذراً</h1>
                <p>نظام الجمعية غير متاح حالياً بسبب مشكلة في الاتصال بقاعدة البيانات.</p>
                <p style="color:red; direction:ltr; text-align: left; background: #ffe6e6; padding: 10px; border-radius: 5px;">
                    <strong>Error Details:</strong><br>
                    ${errorMsg || 'Unknown Error'}<br><br>
                    <strong>Debug Info:</strong> ${debugInfo}<br><br>
                    ${hint}
                </p>
                <p>يرجى المحاولة في وقت لاحق.</p>
                <a href="/">العودة للرئيسية</a>
            </div>
        `);
    }
    next();
};

// Jam3ya Forgot Password Handler
app.post('/jam3ya/forgot-password', checkJam3yaDb, (req, res) => {
    const { phone, email } = req.body;
    
    // 1. Find member by phone
    jam3yaDb.get("SELECT * FROM members WHERE phone = ?", [phone], (err, row) => {
        if (err) {
            console.error("Forgot Password DB Error:", err);
            return res.render('jam3ya-login', { error: 'حدث خطأ في النظام', layout: false, isAdmin: false });
        }
        
        if (!row) {
            return res.render('jam3ya-login', { error: 'رقم الهاتف غير مسجل في النظام', layout: false, isAdmin: false });
        }

        // Helper function to send email
        const sendPasswordEmail = async (targetEmail) => {
            try {
                // Configure Transporter (Support for Gmail and Custom SMTP)
                let transporterConfig;
                if (process.env.SMTP_HOST) {
                    // Custom SMTP (e.g., cPanel Email)
                    // Ensure port is number
                    const port = parseInt(process.env.SMTP_PORT) || 465;
                    transporterConfig = {
                        host: process.env.SMTP_HOST,
                        port: port,
                        secure: port === 465, // true for 465, false for other ports
                        auth: {
                            user: process.env.EMAIL_USER,
                            pass: process.env.EMAIL_PASS
                        },
                        tls: {
                            // Do not fail on invalid certs
                            rejectUnauthorized: false
                        }
                    };
                } else {
                    // Default to Gmail
                    transporterConfig = {
                        service: 'gmail',
                        auth: {
                            user: process.env.EMAIL_USER,
                            pass: process.env.EMAIL_PASS
                        }
                    };
                }

                const transporter = nodemailer.createTransport(transporterConfig);

                if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
                    console.error("Email credentials not set");
                    return res.render('jam3ya-login', { 
                        error: 'لم يتم إعداد خادم البريد الإلكتروني. يرجى التواصل مع الإدارة.', 
                        layout: false, 
                        isAdmin: false 
                    });
                }

                await transporter.sendMail({
                    from: `"جمعية الخطوة الأهلية" <${process.env.EMAIL_USER}>`,
                    to: targetEmail,
                    subject: 'استعادة الرمز السري - جمعية الخطوة الأهلية',
                    html: `
                        <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
                            <p>مرحباً ${row.name}،</p>
                            <p>بناءً على طلبكم، نرسل لكم الرمز السري الخاص بكم للدخول إلى النظام.</p>
                            <br>
                            <p style="font-size: 18px; font-weight: bold; color: #2c3e50;">الرمز السري:</p>
                            <h2 style="background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #ddd; display: inline-block; color: #2980b9; letter-spacing: 2px;">
                                ${row.passcode}
                            </h2>
                            <br><br>
                            <p>مع تحيات،<br>جمعية الخطوة الأهلية</p>
                        </div>
                    `
                });
                
                res.render('jam3ya-login', { 
                    error: null, 
                    success: 'تم إرسال الرمز السري إلى بريدك الإلكتروني بنجاح', 
                    layout: false, 
                    isAdmin: false 
                });
            } catch (emailErr) {
                console.error("Email Send Error:", emailErr);
                res.render('jam3ya-login', { 
                    error: 'حدث خطأ أثناء إرسال البريد الإلكتروني: ' + emailErr.message, 
                    layout: false, 
                    isAdmin: false 
                });
            }
        };
        
        // 2. Check if email is registered
        if (row.email && row.email.trim() !== '') {
            // Case A: Email exists - Verify match
            if (row.email.trim().toLowerCase() === email.trim().toLowerCase()) {
                sendPasswordEmail(row.email);
            } else {
                return res.render('jam3ya-login', { 
                    error: 'البريد الإلكتروني المدخل لا يتطابق مع المسجل لدينا. يرجى التواصل مع مدير النظام.', 
                    layout: false, 
                    isAdmin: false 
                });
            }
        } else {
            // Case B: Email does not exist - Update and Send
            jam3yaDb.run("UPDATE members SET email = ? WHERE id = ?", [email, row.id], (updateErr) => {
                if (updateErr) {
                    console.error("Update Email Error:", updateErr);
                    return res.render('jam3ya-login', { error: 'حدث خطأ أثناء تحديث البريد الإلكتروني', layout: false, isAdmin: false });
                }
                sendPasswordEmail(email);
            });
        }
    });
});

// Jam3ya Login Page (For Regular Members)
app.get('/jam3ya/login', (req, res) => {
    res.render('jam3ya-login', { error: null, layout: false, isAdmin: false });
});

// Jam3ya Login Handler (Passcode only for members & admins)
app.post('/jam3ya/login', checkJam3yaDb, (req, res) => {
    const { passcode } = req.body;
    
    // 1. Check Master Admin Passcode (Fallback)
    const masterPass = process.env.JAM3YA_ADMIN_PASS || '123456';
    if (passcode === masterPass) {
        req.session.jam3ya_admin = true;
        logVisitor(req, 'مدير النظام (Master)');
        return res.redirect('/jam3ya/dashboard');
    }

    // 2. Check Member
    jam3yaDb.get("SELECT * FROM members WHERE passcode = ?", [passcode], (err, row) => {
        if (err) {
            console.error("Member Login DB Error:", err);
            return res.render('jam3ya-login', { error: 'حدث خطأ في النظام: ' + (err.message || err), layout: false, isAdmin: false });
        }
        
        if (row) {
            // Check if Admin
            if (row.is_admin === 1) {
                // Render Role Selection
                req.session.temp_jam3ya_user = row; // Store temporarily
                return res.render('jam3ya-role-select', { name: row.name, layout: false });
            }

            // Successful regular member login
            req.session.jam3ya_member = true;
            req.session.jam3ya_member_id = row.id;
            req.session.jam3ya_member_name = row.name;
            req.session.jam3ya_member_code = row.member_code; // Store member code for linking transactions
            
            logVisitor(req, row.name);

            req.session.save(() => {
                res.redirect('/jam3ya');
            });
        } else {
            res.render('jam3ya-login', { error: 'الرمز السري غير صحيح', layout: false, isAdmin: false });
        }
    });
});

// Confirm Role Selection (Admin vs Member)
app.post('/jam3ya/login/confirm', (req, res) => {
    const user = req.session.temp_jam3ya_user;
    const { role } = req.body;

    if (!user) return res.redirect('/jam3ya/login');

    if (role === 'admin') {
        req.session.jam3ya_admin = true;
        req.session.jam3ya_admin_id = user.id;
        req.session.jam3ya_admin_name = user.name;
        
        // Also set member session just in case they navigate to main page? 
        // User asked for "enter as admin OR member". 
        // If they enter as admin, they go to dashboard.
        // If they enter as member, they go to main page.
        // Let's keep strict separation for now based on user request.
    } else {
        req.session.jam3ya_member = true;
        req.session.jam3ya_member_id = user.id;
        req.session.jam3ya_member_name = user.name;
        req.session.jam3ya_member_code = user.member_code;
    }

    logVisitor(req, user.name + (role === 'admin' ? ' (Admin Access)' : ''));

    delete req.session.temp_jam3ya_user;
    req.session.save(() => {
        if (role === 'admin') res.redirect('/jam3ya/dashboard');
        else res.redirect('/jam3ya');
    });
});

// Helper to process Jam3ya transactions
const processJam3yaData = (rows, initialBalance) => {
    let currentBalance = initialBalance;
    let totalIncome = 0;
    let totalExpense = 0;
    const expensesBySubject = {};

    // Sort by date ASC, id ASC for calculation
    // Note: We clone rows to avoid mutating the original array order if it matters, 
    // but here we just want to process them in chronological order.
    // However, the SQL "ORDER BY date ASC, id ASC" should already ensure this.
    // We will rely on SQL order for calculation.
    
    rows.forEach(row => {
        // Ensure date is string YYYY-MM-DD for display and sorting logic
        if (row.date instanceof Date) {
            row.date = row.date.toISOString().split('T')[0];
        }

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

        if (effectiveAmount > 0) totalIncome += effectiveAmount;
        else totalExpense += Math.abs(effectiveAmount);

        if (row.subject) {
            if (!expensesBySubject[row.subject]) {
                expensesBySubject[row.subject] = {
                    name: row.subject,
                    total: 0,
                    transactions: [],
                    lastDate: row.date || ''
                };
            }
            expensesBySubject[row.subject].total += effectiveAmount;
            expensesBySubject[row.subject].transactions.push(row);
            if (row.date && row.date > expensesBySubject[row.subject].lastDate) {
                expensesBySubject[row.subject].lastDate = row.date;
            }
        }
    });

    const subjectsList = Object.values(expensesBySubject).sort((a, b) => {
        if (b.lastDate < a.lastDate) return -1;
        if (b.lastDate > a.lastDate) return 1;
        return 0;
    });
    
    subjectsList.forEach(subject => subject.transactions.reverse()); // Newest first
    
    // Reverse rows for main display (Newest first)
    const displayRows = [...rows].reverse();

    return {
        transactions: displayRows,
        subjectsList,
        totalIncome,
        totalExpense,
        currentBalance,
        initialBalance
    };
};

// Jam3ya Route
app.get('/jam3ya', checkJam3yaDb, async (req, res) => {
    try {
        let memberId = req.session.jam3ya_member_id;
        let memberCode = req.session.jam3ya_member_code;
        let memberName = req.session.jam3ya_member_name;
        const isAdmin = !!req.session.jam3ya_admin;
        const adminName = req.session.jam3ya_admin_name || 'مدير النظام';

        // Force Login: If not logged in as member or admin, redirect to login
        if (!memberId && !isAdmin) {
            return res.redirect('/jam3ya/login');
        }

        // Refetch Member Code if missing (to fix existing sessions)
        if (memberId && !memberCode) {
            const member = await new Promise((resolve) => {
                jam3yaDb.get("SELECT * FROM members WHERE id = ?", [memberId], (err, row) => {
                    if (err || !row) resolve(null);
                    else resolve(row);
                });
            });
            if (member) {
                memberCode = member.member_code;
                memberName = member.name;
                // Update session
                req.session.jam3ya_member_code = memberCode;
                req.session.jam3ya_member_name = memberName;
                req.session.save();
            }
        }

        // Handle Admin View of Specific Member
        if (isAdmin && req.query.view_member_code) {
            const targetCode = req.query.view_member_code;
            const targetMember = await new Promise((resolve) => {
                jam3yaDb.get("SELECT * FROM members WHERE member_code = ?", [targetCode], (err, row) => {
                    if (err || !row) resolve(null);
                    else resolve(row);
                });
            });

            if (targetMember) {
                // Override for display context in this request only
                memberCode = targetMember.member_code;
                memberName = targetMember.name + " (عرض كمدير)";
                memberId = targetMember.id; // Ensures tabs appear
            }
        }
        
        // 1. Fetch All Transactions (Public/Main View)
        const allTransactionsPromise = new Promise((resolve, reject) => {
            jam3yaDb.all("SELECT * FROM transactions ORDER BY date ASC, id ASC", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // 2. Fetch Member Transactions (If logged in)
        let memberTransactionsPromise = Promise.resolve(null);
        if (memberCode) {
            memberTransactionsPromise = new Promise((resolve, reject) => {
                // Use memberCode (e.g., '101') instead of ID for linking transactions
                jam3yaDb.all("SELECT * FROM transactions WHERE item = ? ORDER BY date ASC, id ASC", [memberCode], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }

        const [allRows, memberRows] = await Promise.all([allTransactionsPromise, memberTransactionsPromise]);

        // Process Data
        const mainData = processJam3yaData(allRows || [], 1240); // 1240 is global initial balance
        
        let memberData = null;
        if (memberRows) {
            memberData = processJam3yaData(memberRows, 0); // 0 is member initial balance
        }

        // Load members list for name search (for member-submitted payments)
        let membersList = [];
        await new Promise((resolve) => {
            jam3yaDb.all("SELECT id, member_code, name, nickname FROM members ORDER BY name ASC", (err, rows) => {
                if (!err && rows) membersList = rows;
                resolve();
            });
        });

        res.render('jam3ya', { 
            title: 'جمعية الخطوة الأهلية', 
            mainData,
            memberData,
            isLoggedIn: !!memberId,
            memberId: memberCode, // Only display Code
            memberName,
            isAdmin,
            adminName,
            membersList,
            layout: false 
        });

    } catch (err) {
        console.error("Jam3ya Page Error:", err);
        res.status(500).send("Database Error");
    }
});

// ==========================================
// Jam'iya Admin Routes
// ==========================================

// Jam'iya Admin Login - Redirect to unified login
app.get('/jam3ya/admin', (req, res) => {
    res.redirect('/jam3ya/login');
});

// Deprecated Admin POST - Redirect
app.post('/jam3ya/admin', (req, res) => {
    res.redirect('/jam3ya/login');
});

// Jam'iya Admin Logout
app.get('/jam3ya/logout', (req, res) => {
    req.session.jam3ya_admin = false;
    req.session.jam3ya_member = false;
    req.session.jam3ya_member_id = null;
    req.session.jam3ya_member_name = null;
    req.session.jam3ya_member_code = null;
    res.redirect('/jam3ya');
});

// Middleware for Jam'iya Admin
const requireJam3yaAdmin = (req, res, next) => {
    if (!req.session.jam3ya_admin) return res.redirect('/jam3ya/login');
    if (!jam3yaDb) return res.status(503).send("Database Unavailable");
    next();
};
// Member-only middleware
const requireJam3yaMember = (req, res, next) => {
    if (!req.session.jam3ya_member) return res.redirect('/jam3ya/login');
    if (!jam3yaDb) return res.status(503).send("Database Unavailable");
    next();
};

app.post('/jam3ya/reminders/send', requireJam3yaAdmin, async (req, res) => {
    try {
        await sendQuarterReminders();
        res.redirect('/jam3ya/dashboard?tab=unpaid');
    } catch (e) {
        console.error("Manual reminder error:", e);
        res.redirect('/jam3ya/dashboard?tab=unpaid');
    }
});

// Handle Add Transaction
app.post('/jam3ya/transactions/add', requireJam3yaAdmin, (req, res) => {
    const { date, type, subject, member_id, description, details, amount } = req.body;
    
    const targetDate = date || new Date().toISOString().split('T')[0];
    let finalAmount = parseFloat(amount);
    
    if (type === 'expense') {
        finalAmount = -Math.abs(finalAmount);
    } else {
        finalAmount = Math.abs(finalAmount);
    }

    const processTransaction = (itemValue) => {
        jam3yaDb.run(
            "INSERT INTO transactions (date, subject, item, details, amount, balance, is_approved, created_by_member) VALUES (?, ?, ?, ?, ?, 0, 1, 0)",
            [targetDate, subject, itemValue, details, finalAmount],
            (err) => {
                if (err) {
                    console.error("Transaction Insert Error:", err);
                    return res.status(500).send("Error adding transaction");
                }
                res.redirect('/jam3ya/dashboard?tab=transactions');
            }
        );
    };

    if (member_id) {
        jam3yaDb.get("SELECT member_code FROM members WHERE id = ?", [member_id], (err, row) => {
            if (err || !row) {
                return res.status(404).send("Member not found");
            }
            processTransaction(row.member_code);
        });
    } else {
        processTransaction(description || '');
    }
});

// Member-submitted contribution (pending approval)
app.post('/jam3ya/transactions/submit', requireJam3yaMember, (req, res) => {
    const { target_member_code, year, amount } = req.body;
    const subject = 'مساهمات الاعضاء';
    const targetDate = new Date().toISOString().split('T')[0];
    const finalAmount = Math.abs(parseFloat(amount));
    const details = year ? String(year) : '';

    const insertForCode = (code) => {
        jam3yaDb.run(
            "INSERT INTO transactions (date, subject, item, details, amount, balance, is_approved, created_by_member) VALUES (?, ?, ?, ?, ?, 0, 0, 1)",
            [targetDate, subject, code, details, finalAmount],
            (err) => {
                if (err) {
                    console.error("Member Submit Error:", err);
                    return res.status(500).send("Error submitting transaction");
                }
                res.redirect('/jam3ya');
            }
        );
    };

    if (target_member_code) {
        jam3yaDb.get("SELECT member_code FROM members WHERE member_code = ?", [target_member_code], (err, row) => {
            if (err || !row) return res.status(404).send("Member code not found");
            insertForCode(row.member_code);
        });
    } else {
        const ownCode = req.session.jam3ya_member_code;
        if (!ownCode) return res.status(403).send("Session member code missing");
        insertForCode(ownCode);
    }
});

// Handle Edit Transaction
app.post('/jam3ya/transactions/edit', requireJam3yaAdmin, (req, res) => {
    const { id, date, type, subject, member_id, description, details, amount } = req.body;
    
    const targetDate = date;
    let finalAmount = parseFloat(amount);
    
    if (type === 'expense') {
        finalAmount = -Math.abs(finalAmount);
    } else {
        finalAmount = Math.abs(finalAmount);
    }

    const processUpdate = (itemValue) => {
        jam3yaDb.run(
            "UPDATE transactions SET date = ?, subject = ?, item = ?, details = ?, amount = ? WHERE id = ?",
            [targetDate, subject, itemValue, details, finalAmount, id],
            (err) => {
                if (err) {
                    console.error("Transaction Update Error:", err);
                    return res.status(500).send("Error updating transaction");
                }
                res.redirect('/jam3ya/dashboard?tab=transactions');
            }
        );
    };

    if (member_id) {
        jam3yaDb.get("SELECT member_code FROM members WHERE id = ?", [member_id], (err, row) => {
            if (err || !row) {
                return res.status(404).send("Member not found");
            }
            processUpdate(row.member_code);
        });
    } else {
        processUpdate(description || '');
    }
});

// Handle Delete Transaction
app.post('/jam3ya/transactions/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run("DELETE FROM transactions WHERE id = ?", [id], (err) => {
        if (err) {
            console.error("Transaction Delete Error:", err);
            return res.status(500).send("Error deleting transaction");
        }
        res.redirect('/jam3ya/dashboard?tab=transactions');
    });
});

// Approve pending transaction
app.post('/jam3ya/transactions/approve', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run("UPDATE transactions SET is_approved = 1 WHERE id = ?", [id], (err) => {
        if (err) {
            console.error("Transaction Approve Error:", err);
            return res.status(500).send("Error approving transaction");
        }
        res.redirect('/jam3ya/dashboard?tab=transactions');
    });
});

// Jam'iya Dashboard
app.get('/jam3ya/dashboard', requireJam3yaAdmin, (req, res) => {
    const adminName = req.session.jam3ya_admin_name || 'مدير النظام';
    jam3yaDb.serialize(() => {
        jam3yaDb.all("SELECT * FROM members ORDER BY name ASC", (err, members) => {
            if (err) return res.status(500).send("DB Error (Members): " + err.message);
            jam3yaDb.all("SELECT * FROM subjects ORDER BY name ASC", (err, subjects) => {
                if (err) {
                    // If subjects table missing, assume empty
                    if (err.message && err.message.includes("Table") && err.message.includes("doesn't exist")) {
                        subjects = [];
                    } else {
                        return res.status(500).send("DB Error (Subjects): " + err.message);
                    }
                }
                // Fetch in ASC order for correct balance calculation
                jam3yaDb.all("SELECT * FROM transactions ORDER BY date ASC, id ASC", (err, transactions) => {
                    if (err) return res.status(500).send("DB Error (Transactions): " + err.message);


                    // Get active subjects (Top 4 most used)
                    const subjectCounts = {};
                    transactions.forEach(t => {
                        subjectCounts[t.subject] = (subjectCounts[t.subject] || 0) + 1;
                    });
                    
                    const activeSubjects = Object.entries(subjectCounts)
                        .sort((a, b) => b[1] - a[1]) // Sort by count desc
                        .slice(0, 4) // Take top 4
                        .map(entry => entry[0]);

                    // Calculate Summary Data
                    const mainData = processJam3yaData(transactions, 1240); // 1240 is global initial balance

                    // Fetch Visitors
                    jam3yaDb.all("SELECT * FROM visitors ORDER BY id DESC LIMIT 200", (err, visitors) => {
                        if (err) visitors = [];
                        
                        // Map member codes to names
                        const memberMap = {};
                    members.forEach(m => memberMap[m.member_code] = m.name);

                    // Process transactions to show real names and reverse for display (Newest First)
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
                    }).reverse(); // Reverse to show newest first

                    // Identify Unpaid Members for Current Year & Prepare Payment Report by Years
                    const currentYear = new Date().getFullYear().toString();
                    const paidMemberCodes = new Set();
                    
                    // Logic for Payment Report
                    const paymentReport = {}; // { memberCode: { '2023': amount, '2024': amount } }
                    const yearsSet = new Set(['2023', '2024', currentYear]); // Start with requested years

                    transactions.forEach(t => {
                        // Ensure date is string YYYY-MM-DD
                        let dateStr = t.date;
                        if (t.date instanceof Date) {
                            dateStr = t.date.toISOString().split('T')[0];
                        } else {
                            dateStr = String(t.date);
                        }
                        
                        // Update t.date for display consistency
                        t.date = dateStr;

                        const subject = (t.subject || '').trim();
                        const item = (t.item || '').toString().trim();
                        // Normalize details: convert Arabic-Indic digits to ASCII and stringify
                        let details = (t.details || '').toString();
                        details = details.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

                        if (subject === 'مساهمات الاعضاء') {
                            // Extract all 4-digit years from details (e.g., 2024, 2025)
                            // We look for 20xx where xx is 20-30 to avoid matching other random 4-digit numbers if possible, 
                            // but sticking to \b20\d{2}\b is safer for general years.
                            const yearsInDetails = details.match(/\b20\d{2}\b/g);
                            
                            let isPaidForCurrentYear = false;
                            
                            // Determine which years this transaction covers
                            let coveredYears = [];
                            if (yearsInDetails && yearsInDetails.length > 0) {
                                coveredYears = yearsInDetails;
                            } else {
                                // Fallback to transaction date year if no years in details
                                if (dateStr) {
                                    coveredYears = [dateStr.split('-')[0]];
                                }
                            }

                            // Update Payment Report
                            if (!paymentReport[item]) paymentReport[item] = {};
                            coveredYears.forEach(year => {
                                if (year >= '2023') { // Only track from 2023 onwards as requested/relevant
                                    yearsSet.add(year);
                                    if (!paymentReport[item][year]) paymentReport[item][year] = 0;
                                    // If multiple years in details, split amount? Or attribute full amount to each?
                                    // Usually amount covers one year unless specified.
                                    // Assumption: If details say "2024, 2025" and amount is 24, it likely means 12 for each.
                                    // BUT simplest approach: Attribute full amount to each year listed, or just mark as paid.
                                    // User wants "Amount he paid". If he paid 12 and details say "2024", he paid 12 for 2024.
                                    // If details "2024, 2025", he paid for both. Splitting is risky without knowing rules.
                                    // Better approach: If multiple years, duplicate the amount entry? 
                                    // No, let's assume one transaction = one year usually. 
                                    // If details has multiple years, it's ambiguous. 
                                    // Let's assume the amount is total. We will just ADD the transaction amount to that year's bucket.
                                    // If multiple years are listed, we add the FULL amount to EACH year? No, that inflates total.
                                    // Let's divide the amount by number of years if multiple years are detected.
                                    const amountPerYear = t.amount / coveredYears.length;
                                    paymentReport[item][year] += amountPerYear;
                                }
                            });

                            // Logic for Unpaid List (Current Year)
                            if (yearsInDetails && yearsInDetails.length > 0) {
                                // If details contain years, strict check against currentYear
                                if (yearsInDetails.includes(currentYear)) {
                                    isPaidForCurrentYear = true;
                                }
                            } else {
                                // If details contain NO year, fallback to transaction date
                                if (dateStr && dateStr.startsWith(currentYear)) {
                                    isPaidForCurrentYear = true;
                                }
                            }

                            if (isPaidForCurrentYear) {
                                paidMemberCodes.add(item);
                                // Debug log for specific member 1330 to verify logic in production
                                if (item === '1330') {
                                    console.log(`[DEBUG] Member 1330 Marked as PAID. Source: ${yearsInDetails ? 'Details (' + yearsInDetails + ')' : 'Date (' + dateStr + ')'}`);
                                }
                            }
                        }
                    });

                    // Prepare sorted years array for the view
                    const sortedYears = Array.from(yearsSet).sort();

                    // Calculate Yearly Totals
                    const yearlyTotals = {};
                    sortedYears.forEach(year => yearlyTotals[year] = 0);

                    // Identify inactive members to exclude from statistics
                    const inactiveMemberCodes = new Set();
                    members.forEach(m => {
                        if (m.is_active == 0) inactiveMemberCodes.add(String(m.member_code).trim());
                    });

                    Object.entries(paymentReport).forEach(([memberCode, memberPayments]) => {
                        // Skip inactive members from statistics
                        if (inactiveMemberCodes.has(memberCode)) return;

                        for (const [year, amount] of Object.entries(memberPayments)) {
                            if (yearlyTotals[year] !== undefined) {
                                yearlyTotals[year] += amount;
                            }
                        }
                    });

                    const unpaidMembers = members.filter(m => {
                        const memberCode = (m.member_code || '').toString().trim();
                        // Check if active (1 or null/undefined, but NOT 0)
                        // Note: Loose equality (==) handles string '1' vs number 1
                        const isActive = (m.is_active == 1 || m.is_active == null);
                        
                        // If inactive, exclude from unpaid list (return false)
                        if (!isActive) return false;

                        // If already paid, exclude from unpaid list (return false)
                        if (paidMemberCodes.has(memberCode)) return false;

                        // Otherwise, they are unpaid and active
                        return true;
                    });

                    res.render('jam3ya-dashboard', { 
                        members, 
                        subjects, 
                        activeSubjects,
                        transactions: processedTransactions, 
                        unpaidMembers, // Pass to view
                        paymentReport, // Pass to view
                        yearlyTotals,  // Pass to view
                        sortedYears,   // Pass to view
                        mainData,
                        adminName, 
                        visitors, // Pass visitors
                        layout: false 
                    });
                });
            });
            });
        });
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
                const processed = processJam3yaData(rows, 1240);
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
                processJam3yaData(rows, 1240);
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
