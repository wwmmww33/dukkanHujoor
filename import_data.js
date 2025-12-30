const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

async function importData() {
    console.log('Starting data import...');

    const tables = [
        `CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`,
        `CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            phone TEXT UNIQUE,
            password TEXT NOT NULL,
            reset_password_token TEXT,
            reset_password_expires DATETIME,
            email TEXT,
            bio TEXT,
            avatar TEXT,
            is_admin INTEGER DEFAULT 0,
            is_main_store INTEGER DEFAULT 0,
            is_suspended INTEGER DEFAULT 0,
            suspension_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            price DECIMAL(10,2) NOT NULL,
            product_condition TEXT DEFAULT 'used',
            category_id INTEGER,
            image_path TEXT,
            youtube_link TEXT,
            status TEXT DEFAULT 'available',
            admin_hidden INTEGER DEFAULT 0,
            admin_hide_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(category_id) REFERENCES categories(id)
        )`,
        `CREATE TABLE IF NOT EXISTS whatsapp_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_phone TEXT,
            message_content TEXT,
            message_type TEXT DEFAULT 'text',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    // Create tables
    for (const sql of tables) {
        await new Promise((resolve, reject) => {
            db.run(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Using NULL variable for clarity
    const NULL = null;
    
    // Insert Users
    const users = [
        [1, 'مدير النظام', 'admin', '$2b$10$rOzKwKvGOKxMH8.WvF5Ziu8qF5Zt5Zt5Zt5Zt5Zt5Zt5Zt5Zt5Zt5Zt', 'a36ad6c3f2d19f4768af8d1c0b734d9aea686ae1', '2025-09-09 16:27:12', 'admin@dukan-alhujoor.com', NULL, NULL, 1, 0, 0, NULL, '2025-09-07 08:36:12'],
        [2, 'ARAJHI', '94452241', '$2b$10$hgNVCplwm7dSDM1qySlhBOCGRC97cr7ISEhClFzdR2GiF9tiXHNbG', NULL, NULL, 'wwmmww33@gmail.com', '', 'compressed-1757867462166.webp', 0, 1, 0, NULL, '2025-09-07 12:32:27'],
        [3, 'أم ريم', '95249394', '$2b$10$kOAlwOxruJqQLQlpHSOJOejMA8xKlpbSONf8ePObyRzl6RuGlFpgW', NULL, NULL, NULL, NULL, NULL, 0, 0, 0, NULL, '2025-09-07 15:00:08'],
        [4, 'ابو مارية', '00000000', '$2b$10$HPipR4nYIqhC2pNlYenBUeaIXDPG8336JIyp6tgB0wTtbYlC8Vw16', NULL, NULL, 'wwmmww33@gmail.com', '', 'compressed-1757445948665.webp', 1, 0, 0, NULL, '2025-09-09 15:03:27'],
        [6, 'هلال بن راشد الراجحي', '99632104', '$2b$10$YunUnMOIJTTYDLUxkD7/I.npuwxqeFtzJerbPd78se36XxOmDhMue', NULL, NULL, 'alrajhi20@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 13:50:01'],
        [7, 'أشرف سالم الراجحي', '96781777', '$2b$10$RAV3sdA1DN9nDP2X4GX/mumu4sv0aQCuRWSIF15rK5YxjODGO6B.S', NULL, NULL, 'shareeef33a3@hotmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 13:51:35'],
        [8, 'special head', '97275457', '$2b$10$V3HLm1ozUuxIF.v.lxQXo.lUmgbjL61WWXmqMNGESsbXTiA2eu5tu', NULL, NULL, 'h.alrajhi99@hotmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 13:52:16'],
        [9, 'adam alrajhi', '94775546', '$2b$10$1q5UMJfJMRl9NLz3WhHJkeDxxrqSfXwG6xrw0WrQ7BeYuCgW2R45a', NULL, NULL, 'aadamaalrajhi@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 13:53:11'],
        [10, 'Aziz Rashid Al Rajhi', '96332000', '$2b$10$bZQgoEmfFDMB4MYdZg1oBu4kOJSINLyNC09jBeKM4f1JmaBv8nFnS', NULL, NULL, 'azizrashid32@gmai.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 14:11:12'],
        [11, 'SAUD ', '95153147', '$2b$10$XeL1hokZQBoobWSLkLER9epKJPKH8KFLQiioSsQ.g275modL1P5Rq', NULL, NULL, 'ssrhn1992@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 14:21:09'],
        [12, 'Fahad Aziz Alrajhi', '95908488', '$2b$10$bSYbCuVPytpj4S8JGDgnX.bZByFCMsrTt3lsskqkf8cR7yQV1ffKy', NULL, NULL, 'fahad23@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 14:29:14'],
        [13, 'أحمد محمد السلماني ', '99342159', '$2b$10$zc2jgbIxWio2il7ld5QcL..HkGEyPDm3NPbt/l/qfxE34sqc5a1sy', NULL, NULL, 'hakeem225@hotmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 14:46:46'],
        [14, 'Abo Esaam', '99277211', '$2b$10$7WaWefx5xwCQIdS6/tOvruPJp.brhBw/a/1m2jxQTT0jF2eCEZJYS', NULL, NULL, 'squ130@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-10 15:20:24'],
        [15, 'DS', '92688004', '$2b$10$bOUlBW648krGNDuk87859OKHRLgviFzj.AUdzIngEK7XomKc0NsoO', NULL, NULL, 'daud.majidi12@icloud.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-11 00:31:40'],
        [16, 'خليفة بن سعيد بن ناصر العبري', '95676633', '$2b$10$hALeUZZ.Cy4NEJVe2KkT1.LJpHUumUnLXuuzndLpnUK4OmNNge3QW', NULL, NULL, 'buhamad541@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-11 00:48:42'],
        [17, 'Yousuf Said AL Lamki ', '99216884', '$2b$10$y4HXES.iwRGrvungeiPBp.RGDFeJdsf3DzTfX6LxJf9Wfk4eIfthu', NULL, NULL, 'yousuf99216@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-11 01:01:59'],
        [18, 'Abu Zeyad', '79074543', '$2b$10$ZOccdU4EJ1dBASg6Rb033eu4OCEbszMdO26a96ASVeCkfbLVe54MW', NULL, NULL, 'forever0@hotmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-11 05:15:00'],
        [19, 'سالم ', '97007040', '$2b$10$9o/NvoKHkpar9cwd5i/Dqe06rrjkc.oehaEjWxBXTTBC550BcCXfO', NULL, NULL, 'salim900r@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-11 06:31:02'],
        [20, 'Khalid ', '99558687', '$2b$10$9ESt.FoYyJf/z0rIW1G2beKos8CGlJisBYTVXTykhLRkJARVLgpn6', NULL, NULL, 'k.alrajhi99@hotmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-12 14:51:49'],
        [21, 'س س ع ', '92040626', '$2b$10$dxIMWCIoT/cxcQzsc5klY.W.SFLg/y1lqk1ZQawN0r9Bi25dKtpZm', NULL, NULL, 'suhailsalim5522@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-12 15:06:32'],
        [22, 'بدر الراجحي ', '92622038', '$2b$10$4tR4ylRV/UvspjexPz0YyeY0i3fzcl4tmOSeAx5k.i5o3ts3DcqfC', NULL, NULL, 'baderua1@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-13 00:01:56'],
        [23, 'منوعات نسائية', '98516604', '$2b$10$QF2.Gl0YxqYeNp2ufjbn7ObkjI6aPfpEuKAWCaS.DF7h/bJp.p92S', NULL, NULL, 'khawla201401@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-13 06:42:24'],
        [24, 'محمد راشد الراجحي', '99571297', '$2b$10$XTqDmIiwhlQEOdvNJwX.zuYHvRNd9g263tLWPyXHaVMcqB05THd5q', NULL, NULL, 'mohammed2026@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-15 13:14:00'],
        [25, 'HaroldSusen', '82532191', '$2b$10$0S4yiFelwTqlq7HwQxz8AeCucdbqAUbHC0FvhQmOAUk9rsgMH02SG', NULL, NULL, 'po.s.ti.n.g.meg.a.stopl.ay@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-18 16:37:33'],
        [26, 'اياد الراجحي', '95966142', '$2b$10$Kz2Ll6AlwnnaE9.Ne.v.Req2CWq3Wv73epiylu00ehtnDpewfOMMy', NULL, NULL, 'eyad2007@gmail.com', NULL, NULL, 0, 0, 0, NULL, '2025-09-19 05:34:38']
    ];

    const insertUser = `INSERT OR IGNORE INTO users (id, name, phone, password, reset_password_token, reset_password_expires, email, bio, avatar, is_admin, is_main_store, is_suspended, suspension_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    // Using NULL variable for clarity
    // const NULL = null;

    for (const user of users) {
        await new Promise((resolve, reject) => {
            db.run(insertUser, user, (err) => {
                if (err) console.error('Error inserting user:', err.message);
                resolve();
            });
        });
    }

    // Insert Categories
    const categories = [
        [12, 'أخرى'],
        [13, 'ادوات عمل ومواد'],
        [3, 'الإلكترونيات'],
        [14, 'الاراضي والعقارات'],
        [15, 'التحف والهدايا'],
        [4, 'الجمال والعناية الشخصية'],
        [7, 'الرياضة واللياقة'],
        [16, 'الزراعة ومستلزماتها'],
        [10, 'السيارات والعربات'],
        [11, 'الكتب والقرطاسية'],
        [9, 'المجوهرات والساعات'],
        [1, 'الملابس والموضة'],
        [5, 'المنزل والمطبخ'],
        [6, 'المواد الغذائية'],
        [17, 'خدمات']
    ];

    const insertCategory = `INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)`;

    for (const cat of categories) {
        await new Promise((resolve, reject) => {
            db.run(insertCategory, cat, (err) => {
                if (err) console.error('Error inserting category:', err.message);
                resolve();
            });
        });
    }

    // Insert Products
    const products = [
        [8, 2, 'لوحة اسم للمكتب', 'تصميم لوحه الاسم للمكاتب حسب الطلب بالامكان تغيير الشعارات والاشكال الموجوده..', 8.00, 'new', 9, 'compressed-1757448138621.webp', NULL, 'available', 0, NULL, '2025-09-09 16:02:18'],
        [20, 8, 'حذاء كرة قدم', 'حذاء كرة القدم الرجالية عالية الأداء - قابل للتنفس، غير قابل للانزلاق، أحذية كرة قدم برباط للتدريب والمنافسة', 10.00, 'new', 7, 'compressed-1757528034198.webp', NULL, 'available', 0, NULL, '2025-09-10 14:13:54'],
        [21, 6, 'نظارة حاسوب', 'نظارة حاسوب ممتازة. تقلل بشكل كبير من أضرار الأشعة فوق البنفسجية', 7.00, 'used', 3, 'compressed-1757528334673.webp', NULL, 'available', 0, NULL, '2025-09-10 14:18:54'],
        [22, 2, 'فرجار - كليبر', 'فرجار خشبي خفيف وعملي جدا يقيس حتى 20 سم. صناعة محلية', 6.00, 'new', 13, 'compressed-1757557607858.webp', NULL, 'available', 0, NULL, '2025-09-10 22:26:48'],
        [23, 18, 'Sahwa', NULL, 1.80, 'new', 6, 'compressed-1757582341441.webp', NULL, 'available', 0, NULL, '2025-09-11 05:19:01'],
        [24, 2, 'لوحه فنيه خشبيه بارزه', 'السعر لحجم اي A4 وسمك اللوحه 6 ملم', 5.00, 'new', 15, 'compressed-1757586497416.webp', NULL, 'available', 0, NULL, '2025-09-11 06:28:17'],
        [29, 2, 'سوبر ماريو', 'لوحة المرحلة الاولى من لعبة سوبر ماريو حجم A4 كرتونية', 2.00, 'new', 15, 'compressed-1757653333907.webp', NULL, 'available', 0, NULL, '2025-09-12 01:02:14'],
        [30, 2, 'مكيف جنرال', 'المكيف من النوع القديم وبحاجه الى غاز', 80.00, 'used', 3, 'compressed-1757684426571.webp', NULL, 'available', 0, NULL, '2025-09-12 09:40:26'],
        [31, 22, 'تاريخ نيابة الحوقين', 'موسوعة مصورة من 8 مجلدات تحكي تاريخ نيابة الحوقين بأوديتها مثل وادي الحوقين ووادي الحيملي ووادي الحاجر.\r\nاستمتع بقراءة الكتاب وتنقل بين أجزائه الثمانية بين البيوت الأثرية والحصون والابراج والكتابات الأثرية والمخطوطات والأفلاج بل وحتى التعرف على الأعلام والمعالم التاريخية العامة في النيابة.\r\nكتاب لا تمل قرائته والاطلاع عليه.\r\nأنيسك عند وحدتك.\r\nالكتاب الفائز بالمركز الأول في مسابقة الجمعية العمانية للكتاب والأدباء للابداع الثقافي.', 50.00, 'new', 11, 'compressed-1757737202611.webp', NULL, 'available', 0, NULL, '2025-09-13 00:20:02'],
        [32, 23, 'بطانية ', 'حرير ساتان حشو لشخصين ثمان قطع يوجد الوان اخرى ', 16.00, 'new', 5, 'compressed-1757760456961.webp', NULL, 'available', 0, NULL, '2025-09-13 06:47:37'],
        [33, 2, 'هدية شباب عمان متحركة', 'هديه لسفينه شباب عمان متحركه ومغطاه بالزجاج طول الهديه 20 سم وعرضها 8 سم، تعمل بالبطاريات الصغيره', 15.00, 'new', 15, 'compressed-1757765566471.webp', 'https://youtube.com/shorts/0-p8fbp6PSc?si=W1fpAirCZwYWgJ5r', 'available', 0, NULL, '2025-09-13 08:11:43'],
        [34, 2, 'هدية تذكارية في قبة زجاجية', 'تفصيلها حسب الطلب\r\nابعاد الهديه 25 في25 سم\r\n', 25.00, 'new', 15, 'compressed-1762595519165.webp', 'https://www.youtube.com/watch?v=j7b9tOniqCo', 'available', 0, NULL, '2025-11-08 04:51:59']
    ];

    const insertProduct = `INSERT OR IGNORE INTO products (id, user_id, title, description, price, product_condition, category_id, image_path, youtube_link, status, admin_hidden, admin_hide_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const prod of products) {
        await new Promise((resolve, reject) => {
            db.run(insertProduct, prod, (err) => {
                if (err) console.error('Error inserting product:', err.message);
                resolve();
            });
        });
    }

    console.log('Data import completed successfully.');
    db.close();
}

importData();
