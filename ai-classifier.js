// ai-classifier.js (Powered by Google Gemini - Corrected Syntax)
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mysql = require('mysql2/promise');

// 1. تهيئة عميل Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const pool = mysql.createPool({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, charset: 'utf8mb4'
});

// 2. تحويل بيانات الصورة إلى الصيغة التي يفهمها Gemini
function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString("base64"),
            mimeType
        },
    };
}

async function getAIsuggestedCategory(productTitle, productDescription, imageBuffer, imageMimeType) {
    try {
        // 3. اختيار الموديل وتجهيز البيانات
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const [categories] = await pool.execute("SELECT name FROM categories");
        const categoryList = categories.map(c => c.name).join(', ');

        const prompt = `
            You are an expert e-commerce product classifier. Your task is to determine the most appropriate category for a product based on its title, description, and image.
            You must choose only ONE category from the following available list: [${categoryList}].
            
            Product Data:
            - Title: ${productTitle}
            - Description: ${productDescription || 'No description provided'}
            
            Analyze the data and the provided image, then return your answer ONLY as a JSON object, with no extra text, in this format:
            { "categoryName": "The category name you chose from the list" }
        `;

        const imagePart = fileToGenerativePart(imageBuffer, imageMimeType);

        // 4. إرسال الطلب إلى Gemini API
        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        
        // 5. تحليل الرد
        const cleanedResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const resultJson = JSON.parse(cleanedResponse);

        return resultJson;

    } catch (error) { // <-- تم إضافة القوس الناقص هنا
        console.error("Google AI Classification Error:", error);
        return null;
    }
}

module.exports = { getAIsuggestedCategory };