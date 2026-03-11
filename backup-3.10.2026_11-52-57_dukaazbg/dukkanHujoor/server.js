// =============================================================================
// الخادم النهائي والشامل - دكان الحجور - V12 (مع إصلاح Title و Session Store)
// =============================================================================
/*require('dotenv').config();
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

app.use(cookieParser());
app.use(i18n.init);
app.use((req, res, next) => {
    res.locals.__ = res.__; // دالة الترجمة الرئيسية
    res.locals.locale = req.getLocale(); // اللغة الحالية
    next();
});*/
const { getAIsuggestedCategory } = require('./ai-classifier');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const sharp = require('sharp');
const MySQLStore = require('express-mysql-session')(session); // <-- تم تصحيح اسم الحزمة هنا
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);

const pool = mysql.createPool({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10, queueLimit: 0, charset: 'utf8mb4'
});

const sessionStore = new MySQLStore({}, pool); // <-- لإصلاح MemoryStore

// Middlewares
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

module.exports = app;