// ai-classifier.js (Powered by DeepSeek AI)
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, charset: 'utf8mb4'
});

/**
 * دالة لاستدعاء DeepSeek API لتصنيف المنتج
 * @param {string} productTitle - عنوان المنتج
 * @param {string} productDescription - وصف المنتج
 * @param {Buffer} [imageBuffer] - محتوى الصورة (اختياري - مستقبلاً)
 * @param {string} [imageMimeType] - نوع الصورة (اختياري)
 * @returns {Promise<{categoryName: string}|null>}
 */
async function getAIsuggestedCategory(productTitle, productDescription, imageBuffer, imageMimeType) {
    try {
        const [categories] = await pool.execute("SELECT name FROM categories");
        const categoryList = categories.map(c => c.name).join(', ');

        const prompt = `أنت خبير في تصنيف المنتجات للتجارة الإلكترونية. مهمتك هي تحديد التصنيف الأنسب لمنتج بناءً على عنوانه ووصفه.

اختر تصنيفاً واحداً فقط من القائمة التالية: [${categoryList}]

بيانات المنتج:
- العنوان: ${productTitle}
- الوصف: ${productDescription || 'لا يوجد وصف'}

حلل البيانات وأعد النتيجة فقط على شكل JSON object بالصيغة التالية (بدون أي نص إضافي):
{ "categoryName": "اسم التصنيف الذي اخترته من القائمة" }`;

        // استدعاء DeepSeek API
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY || 'sk-d5b94e043ed9490984fbce486fc9ff68'}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: 'أنت مساعد تصنيف منتجات دقيق. أجب فقط بـ JSON.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 100
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('DeepSeek API Error:', response.status, errorText);
        return null;
    }

        const data = await response.json();
        const responseText = data.choices?.[0]?.message?.content || '';

        // تحليل الرد
        const cleanedResponse = responseText
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .replace(/^[^{]*/, '')  // إزالة أي نص قبل أول {
            .replace(/[^}]*$/, '')  // إزالة أي نص بعد آخر }
            .trim();

        if (!cleanedResponse) {
            console.error('DeepSeek: رد فارغ من API');
            return null;
}

        const resultJson = JSON.parse(cleanedResponse);

        if (!resultJson.categoryName) {
            console.error('DeepSeek: الرد لا يحتوي على categoryName');
            return null;
        }

        return resultJson;

    } catch (error) {
        console.error('DeepSeek AI Classification Error:', error);
        return null;
    }
}

module.exports = { getAIsuggestedCategory };