// test-ai.js - A simple script to test the connection to Google AI

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// تأكد من أن مفتاح API موجود
if (!process.env.GOOGLE_API_KEY) {
    console.error('ERROR: GOOGLE_API_KEY is not defined in your .env file.');
    process.exit(1); // إنهاء البرنامج مع خطأ
}

// تهيئة العميل
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function runTest() {
    console.log('Starting Google AI connection test...');
    try {
        // اختيار موديل نصي فقط لتبسيط الاختبار
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = "What is the capital of Oman?";

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        console.log("✅ SUCCESS! The connection to Google AI is working.");
        console.log("Response from AI:", text);

    } catch (error) {
        console.error("❌ TEST FAILED. There is a problem connecting to Google AI.");
        console.error("Detailed Error:", error);
    }
}

runTest();