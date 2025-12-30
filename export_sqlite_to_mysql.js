const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'dukaazbg_jam3yatKA.sqlite');
const db = new sqlite3.Database(dbPath);
const outputPath = path.join(__dirname, 'jam3ya_dump.sql');

const stream = fs.createWriteStream(outputPath);

stream.write(`-- SQL Dump generated for MySQL import
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

`);

db.serialize(() => {
    // 1. Members Table
    stream.write(`
-- Table structure for table \`members\`
CREATE TABLE IF NOT EXISTS \`members\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`member_code\` varchar(255) NOT NULL,
  \`name\` varchar(255) NOT NULL,
  \`nickname\` varchar(255) DEFAULT NULL,
  \`phone\` varchar(255) DEFAULT NULL,
  \`email\` varchar(255) DEFAULT NULL,
  \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
  \`passcode\` varchar(255) DEFAULT NULL,
  \`notes\` text,
  \`is_active\` tinyint(1) DEFAULT 1,
  \`is_admin\` tinyint(1) DEFAULT 0,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dumping data for table \`members\`
`);
    
    db.all("SELECT * FROM members", (err, rows) => {
        if (rows.length > 0) {
            stream.write("INSERT INTO `members` (`id`, `member_code`, `name`, `nickname`, `phone`, `email`, `created_at`, `passcode`, `notes`, `is_active`, `is_admin`) VALUES\n");
            const values = rows.map(row => {
                return `(${row.id}, '${escape(row.member_code)}', '${escape(row.name)}', ${quote(row.nickname)}, ${quote(row.phone)}, ${quote(row.email)}, ${quote(row.created_at)}, ${quote(row.passcode)}, ${quote(row.notes)}, ${row.is_active || 1}, ${row.is_admin || 0})`;
            }).join(",\n");
            stream.write(values + ";\n\n");
        }

        // 2. Subjects Table
        stream.write(`
-- Table structure for table \`subjects\`
CREATE TABLE IF NOT EXISTS \`subjects\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`name\` varchar(255) NOT NULL,
  \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dumping data for table \`subjects\`
`);
        db.all("SELECT * FROM subjects", (err, rows) => {
            if (rows.length > 0) {
                stream.write("INSERT INTO `subjects` (`id`, `name`, `created_at`) VALUES\n");
                const values = rows.map(row => {
                    return `(${row.id}, '${escape(row.name)}', ${quote(row.created_at)})`;
                }).join(",\n");
                stream.write(values + ";\n\n");
            }

            // 3. Transactions Table
            stream.write(`
-- Table structure for table \`transactions\`
CREATE TABLE IF NOT EXISTS \`transactions\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`date\` datetime DEFAULT NULL,
  \`subject\` varchar(255) DEFAULT NULL,
  \`item\` varchar(255) DEFAULT NULL,
  \`details\` text,
  \`amount\` decimal(15,3) DEFAULT NULL,
  \`balance\` decimal(15,3) DEFAULT NULL,
  \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dumping data for table \`transactions\`
`);
            db.all("SELECT * FROM transactions", (err, rows) => {
                if (rows.length > 0) {
                    // Split into chunks of 500 to avoid huge queries
                    const chunkSize = 500;
                    for (let i = 0; i < rows.length; i += chunkSize) {
                        const chunk = rows.slice(i, i + chunkSize);
                        stream.write("INSERT INTO `transactions` (`id`, `date`, `subject`, `item`, `details`, `amount`, `balance`, `created_at`) VALUES\n");
                        const values = chunk.map(row => {
                            return `(${row.id}, ${quote(row.date)}, ${quote(row.subject)}, ${quote(row.item)}, ${quote(row.details)}, ${formatNumber(row.amount)}, ${formatNumber(row.balance)}, ${quote(row.created_at)})`;
                        }).join(",\n");
                        stream.write(values + ";\n");
                    }
                    stream.write("\n");
                }
                
                stream.write("COMMIT;\n");
                stream.end();
                console.log("Dump created successfully at jam3ya_dump.sql");
            });
        });
    });
});

function formatNumber(val) {
    if (val === null || val === undefined || val === '') return 'NULL';
    // Convert to string to handle replacement
    let str = String(val);
    // Replace Arabic decimal separator (٫) and comma (,) with dot (.)
    // The Arabic decimal separator is \u066B
    str = str.replace(/[\u066B,]/g, '.');
    // Remove any other non-numeric characters except - and .
    // (Optional: depending on how dirty the data is, but usually just swapping separator is enough)
    
    // Check if it's a valid number
    if (isNaN(parseFloat(str))) return 'NULL';
    return str;
}

function escape(str) {
    if (str === null || str === undefined) return '';
    return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
        switch (char) {
            case "\0": return "\\0";
            case "\x08": return "\\b";
            case "\x09": return "\\t";
            case "\x1a": return "\\z";
            case "\n": return "\\n";
            case "\r": return "\\r";
            case "\"": return "\\\"";
            case "'": return "\\'";
            case "\\": return "\\\\";
            case "%": return "\\%";
        }
    });
}

function quote(str) {
    if (str === null || str === undefined) return 'NULL';
    return `'${escape(str)}'`;
}
