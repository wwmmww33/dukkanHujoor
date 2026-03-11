ls /home/dukaazbg/nodevenv/dukan-alhujoor.com/
source /home/dukaazbg/nodevenv/dukan-alhujoor.com/22/bin/activate 
source /home/dukaazbg/nodevenv/dukan-alhujoor.com/24/bin/activate 
ls /home/dukaazbg/nodevenv
ls /home/dukaazbg
ls /home/dukaazbg/nodevenv
ls /home/dukaazbg/public_html
find /home/dukaazbg/nodevenv -type f -name activate 2>/dev/null
/home/dukaazbg/nodevenv/home/dukaazbg/public_html/24/bin/activate
/home/dukaazbg/nodevenv -type f -name activate 2>/dev/null
source /home/dukaazbg/nodevenv/home/dukaazbg/public_html/24/bin/activate
node -v
npm -v
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/18/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node -v
ls -la
cat .env
npm ci --only=production || npm install --production
node server-mysql.js
dukkanHujoor]$ node -v
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/20/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node server-mysql.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node server-mysql.js
# من التيرمنال
tail -n 200 ~/passenger.log
tail -n 200 error_log 2>/dev/null || tail -n 200 ../error_log 2>/dev/null
curl -i http://127.0.0.1:3000/
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
curl -i http://127.0.0.1:3000/
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node server-mysql.js
curl -i http://127.0.0.1:3000/
cd /home/dukaazbg/public_html/dukkanHujoor
sed -i '/^PORT=/d' .env   # نحذف PORT من .env ليحدد Passenger المنفذ بنفسه
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node server-mysql.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
curl -i http://127.0.0.1:4010/
PORT=4010 node server-mysql.js
curl -i http://127.0.0.1:4010/
PORT=4010 node server-mysql.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
curl -i http://127.0.0.1:3000/
npm install --production
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install
node server.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
cd public_html/dukkanHujoor
node server.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node server.js
 node server.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate
node test_db.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node test_db.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node server.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install ejs
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install connect-session-mysql --save
npm install express-mysql-session --save
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install nodemailer --save
npm install crypto --save
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/16/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install openai --save
npm install node-fetch@2 --save
npm uninstall node-fetch --save
npm install @google/generative-ai 
npm uninstall openai --save
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/18/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
طلب رائع ومهم جدًا لتوسيع قاعدة مستخدمي موقعك. إضافة دعم متعدد اللغات (Internationalization أو i18n) هي خطوة احترافية كبيرة.
هناك طريقتان رئيسيتان لتنفيذ الترجمة في تطبيق Node.js/EJS:
الطريقة البسيطة (ملفات JSON): هي الأنسب لمشروعك حاليًا. ننشئ ملف JSON لكل لغة يحتوي على ترجمة كل النصوص، ثم نقوم بتحميل الملف المناسب بناءً
على اختيار المستخدم.
الطريقة المتقدمة (خدمات الترجمة): استخدام خدمات مثل Google Translate API لترجمة المحتوى ديناميكيًا. هذه الطريقة أكثر تعقيدًا وتكلفة.
سنعتمد على الطريقة الأولى لأنها تمنحك تحكمًا كاملاً في جودة الترجمة وهي فعالة جدًا.
خطة العمل الشاملة
المرحلة الأولى: التحضيرات الأساسية
تثبيت مكتبة i18n-node: هذه هي المكتبة الأكثر شيوعًا وسهولة لإدارة الترجمة في Node.js.
افتح Terminal في cPanel وشغل الأمر:
code
Bash
download
content_copy
expand_less
npm install i18n --save
```2.  **إنشاء مجلد وملفات الترجمة:**

في جذر مشروعك (/dukkanHujoor/)، أنشئ مجلدًا جديدًا باسم locales.

داخل مجلد locales، أنشئ ملفات JSON التالية:

ar.json (للعربية - اللغة الافتراضية)

en.json (للإنجليزية)

hi.json (للهندية)

bn.json (للبنغالية)

fa.json (للفارسية/الإيرانية)

المرحلة الثانية: إعداد i18n في الخادم (server.js)

استدعاء وتهيئة المكتبة:

افتح server.js وفي الأعلى مع باقي الـ require، أضف:

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
const i18n = require('i18n');
const cookieParser = require('cookie-parser'); // سنحتاج هذه المكتبة

ملاحظة: قد تحتاج إلى تثبيت cookie-parser: npm install cookie-parser --save.

بعد const app = express();، أضف كود التهيئة التالي:

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
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

جعل دوال الترجمة متاحة في EJS:

سنضيف middleware بسيطًا يجعل دالة الترجمة __() متاحة في جميع صفحات EJS. أضف هذا السطر مع باقي الـ app.use(...):

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
app.use((req, res, next) => {
    res.locals.__ = res.__; // دالة الترجمة الرئيسية
    res.locals.locale = req.getLocale(); // اللغة الحالية
    next();
});

إنشاء مسار لتغيير اللغة:

أضف هذا المسار الجديد في server.js. هذا المسار سيتم استدعاؤه عندما يختار المستخدم لغة جديدة.

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
app.get('/change-lang/:lang', (req, res) => {
    const { lang } = req.params;
    if (['ar', 'en', 'hi', 'bn', 'fa'].includes(lang)) {
        res.cookie('locale', lang, { maxAge: 900000, httpOnly: true });
    }
    // أعد توجيه المستخدم إلى الصفحة التي كان فيها
    res.redirect('back');
});

المرحلة الثالثة: ملء ملفات الترجمة (JSON)

هذا هو قلب عملية الترجمة. عليك أن تعرّف "مفاتيح" لكل نص في موقعك.

مثال لملف ar.json (العربية):

code
JSON
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
{
  "header": {
    "title": "دكان الحجور",
    "addProduct": "إضافة منتج",
    "myProducts": "منتجاتي"
  },
  "addProductPage": {
    "pageTitle": "إضافة منتج جديد",
    "productNameLabel": "اسم المنتج"
  }
}

مثال لملف en.json (الإنجليزية):

code
JSON
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
{
  "header": {
    "title": "Dukan Alhujoor",
    "addProduct": "Add Product",
    "myProducts": "My Products"
  },
  "addProductPage": {
    "pageTitle": "Add a New Product",
    "productNameLabel": "Product Name"
  }
}

ملاحظة: ستحتاج إلى مترجم لملء ملفات الهندية (hi.json) والبنغالية (bn.json) والفارسية (fa.json) بنفس الطريقة.

المرحلة الرابعة: تحديث صفحات EJS لاستخدام الترجمة

الآن، سنستبدل النصوص الثابتة في ملفات EJS بدالة الترجمة.

مثال لتعديل layout.ejs:

الكود القديم:
<span class="logo-text">دكان الحجور</span>

الكود الجديد:
<span class="logo-text"><%= __('header.title') %></span>

مثال لتعديل add-product.ejs:

الكود القديم:
<h1 class="form-title">✨ إضافة منتج جديد</h1>
<label for="name" class="form-label">📝 عنوان المنتج *</label>

الكود الجديد:
<h1 class="form-title">✨ <%= __('addProductPage.pageTitle') %></h1>
<label for="name" class="form-label">📝 <%= __('addProductPage.productNameLabel') %> *</label>

المرحلة الخامسة: إضافة مبدل اللغة (Language Switcher)

أخيرًا، أضف قائمة منسدلة أو أزرارًا في الهيدر (layout.ejs) ليتمكن المستخدم من تغيير اللغة.

مثال لمبدل اللغة في layout.ejs:

code
Html
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
<div class="language-switcher">
    <a href="/change-lang/ar" class="<%= locale === 'ar' ? 'active' : '' %>">العربية</a> |
    <a href="/change-lang/en" class="<%= locale === 'en' ? 'active' : '' %>">English</a> |
    <a href="/change-lang/hi" class="<%= locale === 'hi' ? 'active' : '' %>">हिन्दी</a> |
    <a href="/change-lang/bn" class="<%= locale === 'bn' ? 'active' : '' %>">বাংলা</a> |
    <a href="/change-lang/fa" class="<%= locale === 'fa' ? 'active' : '' %>">فارسی</a>
</div>

ستحتاج إلى إضافة بعض التنسيقات في style.css لهذا المبدل.

الخلاصة:
هذه هي الخارطة الكاملة لتنفيذ الترجمة. إنها عملية تتطلب وقتاً وجهداً، خاصة في ترجمة كل النصوص وملء ملفات JSON، ولكنها ستجعل موقعك عالمياً.

نصيحتي: ابدأ بلغة واحدة فقط (مثلاً، الإنجليزية) لتجربة العملية.

أكمل الخطوات من 1 إلى 5 مع ملفي ar.json و en.json فقط.

ترجم صفحة واحدة فقط (مثل الصفحة الرئيسية) كتجربة.

بعد أن تتأكد من أن كل شيء يعمل، يمكنك إكمال ترجمة باقي النصوص واللغات.

طلب رائع ومهم جدًا لتوسيع قاعدة مستخدمي موقعك. إضافة دعم متعدد اللغات (Internationalization أو i18n) هي خطوة احترافية كبيرة.
هناك طريقتان رئيسيتان لتنفيذ الترجمة في تطبيق Node.js/EJS:
الطريقة البسيطة (ملفات JSON): هي الأنسب لمشروعك حاليًا. ننشئ ملف JSON لكل لغة يحتوي على ترجمة كل النصوص، ثم نقوم بتحميل الملف المناسب بناءً
على اختيار المستخدم.
الطريقة المتقدمة (خدمات الترجمة): استخدام خدمات مثل Google Translate API لترجمة المحتوى ديناميكيًا. هذه الطريقة أكثر تعقيدًا وتكلفة.
سنعتمد على الطريقة الأولى لأنها تمنحك تحكمًا كاملاً في جودة الترجمة وهي فعالة جدًا.
خطة العمل الشاملة
المرحلة الأولى: التحضيرات الأساسية
تثبيت مكتبة i18n-node: هذه هي المكتبة الأكثر شيوعًا وسهولة لإدارة الترجمة في Node.js.
افتح Terminal في cPanel وشغل الأمر:
code
Bash
download
content_copy
expand_less
npm install i18n --save
```2.  **إنشاء مجلد وملفات الترجمة:**

في جذر مشروعك (/dukkanHujoor/)، أنشئ مجلدًا جديدًا باسم locales.

داخل مجلد locales، أنشئ ملفات JSON التالية:

ar.json (للعربية - اللغة الافتراضية)

en.json (للإنجليزية)

hi.json (للهندية)

bn.json (للبنغالية)

fa.json (للفارسية/الإيرانية)

المرحلة الثانية: إعداد i18n في الخادم (server.js)

استدعاء وتهيئة المكتبة:

افتح server.js وفي الأعلى مع باقي الـ require، أضف:

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
const i18n = require('i18n');
const cookieParser = require('cookie-parser'); // سنحتاج هذه المكتبة

ملاحظة: قد تحتاج إلى تثبيت cookie-parser: npm install cookie-parser --save.

بعد const app = express();، أضف كود التهيئة التالي:

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
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

جعل دوال الترجمة متاحة في EJS:

سنضيف middleware بسيطًا يجعل دالة الترجمة __() متاحة في جميع صفحات EJS. أضف هذا السطر مع باقي الـ app.use(...):

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
app.use((req, res, next) => {
    res.locals.__ = res.__; // دالة الترجمة الرئيسية
    res.locals.locale = req.getLocale(); // اللغة الحالية
    next();
});

إنشاء مسار لتغيير اللغة:

أضف هذا المسار الجديد في server.js. هذا المسار سيتم استدعاؤه عندما يختار المستخدم لغة جديدة.

code
JavaScript
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
app.get('/change-lang/:lang', (req, res) => {
    const { lang } = req.params;
    if (['ar', 'en', 'hi', 'bn', 'fa'].includes(lang)) {
        res.cookie('locale', lang, { maxAge: 900000, httpOnly: true });
    }
    // أعد توجيه المستخدم إلى الصفحة التي كان فيها
    res.redirect('back');
});

المرحلة الثالثة: ملء ملفات الترجمة (JSON)

هذا هو قلب عملية الترجمة. عليك أن تعرّف "مفاتيح" لكل نص في موقعك.

مثال لملف ar.json (العربية):

code
JSON
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
{
  "header": {
    "title": "دكان الحجور",
    "addProduct": "إضافة منتج",
    "myProducts": "منتجاتي"
  },
  "addProductPage": {
    "pageTitle": "إضافة منتج جديد",
    "productNameLabel": "اسم المنتج"
  }
}

مثال لملف en.json (الإنجليزية):

code
JSON
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
{
  "header": {
    "title": "Dukan Alhujoor",
    "addProduct": "Add Product",
    "myProducts": "My Products"
  },
  "addProductPage": {
    "pageTitle": "Add a New Product",
    "productNameLabel": "Product Name"
  }
}

ملاحظة: ستحتاج إلى مترجم لملء ملفات الهندية (hi.json) والبنغالية (bn.json) والفارسية (fa.json) بنفس الطريقة.

المرحلة الرابعة: تحديث صفحات EJS لاستخدام الترجمة

الآن، سنستبدل النصوص الثابتة في ملفات EJS بدالة الترجمة.

مثال لتعديل layout.ejs:

الكود القديم:
<span class="logo-text">دكان الحجور</span>

الكود الجديد:
<span class="logo-text"><%= __('header.title') %></span>

مثال لتعديل add-product.ejs:

الكود القديم:
<h1 class="form-title">✨ إضافة منتج جديد</h1>
<label for="name" class="form-label">📝 عنوان المنتج *</label>

الكود الجديد:
<h1 class="form-title">✨ <%= __('addProductPage.pageTitle') %></h1>
<label for="name" class="form-label">📝 <%= __('addProductPage.productNameLabel') %> *</label>

المرحلة الخامسة: إضافة مبدل اللغة (Language Switcher)

أخيرًا، أضف قائمة منسدلة أو أزرارًا في الهيدر (layout.ejs) ليتمكن المستخدم من تغيير اللغة.

مثال لمبدل اللغة في layout.ejs:

code
Html
download
content_copy
expand_less
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END
<div class="language-switcher">
    <a href="/change-lang/ar" class="<%= locale === 'ar' ? 'active' : '' %>">العربية</a> |
    <a href="/change-lang/en" class="<%= locale === 'en' ? 'active' : '' %>">English</a> |
    <a href="/change-lang/hi" class="<%= locale === 'hi' ? 'active' : '' %>">हिन्दी</a> |
    <a href="/change-lang/bn" class="<%= locale === 'bn' ? 'active' : '' %>">বাংলা</a> |
    <a href="/change-lang/fa" class="<%= locale === 'fa' ? 'active' : '' %>">فارسی</a>
</div>

ستحتاج إلى إضافة بعض التنسيقات في style.css لهذا المبدل.

الخلاصة:
هذه هي الخارطة الكاملة لتنفيذ الترجمة. إنها عملية تتطلب وقتاً وجهداً، خاصة في ترجمة كل النصوص وملء ملفات JSON، ولكنها ستجعل موقعك عالمياً.

نصيحتي: ابدأ بلغة واحدة فقط (مثلاً، الإنجليزية) لتجربة العملية.

أكمل الخطوات من 1 إلى 5 مع ملفي ar.json و en.json فقط.

ترجم صفحة واحدة فقط (مثل الصفحة الرئيسية) كتجربة.


source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/18/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install i18n --save
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/18/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
npm install cookie-parser --save
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/18/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node test-ai.js
source /home/dukaazbg/nodevenv/public_html/dukkanHujoor/18/bin/activate && cd /home/dukaazbg/public_html/dukkanHujoor
node test-ai.js
source /home/dukaazbg/nodevenv/public_html/jam3ya/18/bin/activate && cd /home/dukaazbg/public_html/jam3ya
npm install
node -v
ls
cd public_html/
ls
cd jam3ya-gpt/
ls
cat stderr.log 
node -v
cat server.js
ls
cd home/
ls
cd dukaazbg/
ls
ps aux | grep node
kill 1672325
ls
ps aux | grep node
docker ps
ls
cd public_html/
ls
ps aux | grep node
cd etc
ls
cd ..
ls
cd etc/
ls
cd ..
ls
cd logs/
ls
ls -l
ps aux
ps aux | grep node
pm2 list
systemctl list-units --type=service | grep node
sudo systemctl list-units --type=service | grep node
sodu systemctl list-units --type=service | grep node
ls
cd /
ls
cd var/
ls
cd log/
ls
ls -l
