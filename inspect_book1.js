const xlsx = require('xlsx');
const workbook = xlsx.readFile('Book1.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

console.log('First 5 rows of Book1.xlsx:');
console.log(JSON.stringify(data.slice(0, 5), null, 2));
