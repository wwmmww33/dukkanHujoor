const XLSX = require('xlsx');

try {
    const workbook = XLSX.readFile('transactions.xlsx');
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert to JSON to see structure
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log('Sheet Name:', sheetName);
    console.log('Headers (Row 1):', data[0]);
    console.log('First Row Data:', data[1]);
    console.log('Second Row Data:', data[2]);
    
} catch (error) {
    console.error('Error reading Excel file:', error.message);
}
