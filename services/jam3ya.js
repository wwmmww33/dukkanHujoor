const path = require('path');

/**
 * Jam3ya service initializer.
 *
 * Contract:
 * - initJam3ya({ sqlite3, Jam3yaMySQLAdapter, env, baseDir }) => { jam3yaDb, jam3yaDbError, tryMysqlFallback }
 * - jam3yaDb implements sqlite3-like API: all/get/run/serialize
 */
function initJam3ya({ sqlite3, Jam3yaMySQLAdapter, env, baseDir }) {
  let jam3yaDb = null;
  let jam3yaDbError = null;

  const tryMysqlFallback = () => {
    if (env.NODE_ENV === 'production') {
      try {
        jam3yaDb = new Jam3yaMySQLAdapter({
          host: env.JAM3YA_DB_HOST,
          user: env.JAM3YA_DB_USER,
          password: env.JAM3YA_DB_PASSWORD,
          database: env.JAM3YA_DB_NAME,
        });
        jam3yaDbError = null;
      } catch (e) {
        jam3yaDbError = (jam3yaDbError ? jam3yaDbError + ' | ' : '') + 'MySQL Fallback Failed: ' + e.message;
        jam3yaDb = null;
      }
    }
  };

  // Prefer MySQL in production
  if (env.NODE_ENV === 'production' && Jam3yaMySQLAdapter) {
    tryMysqlFallback();
  }

  // Fallback to SQLite (dev or if MySQL fails)
  if (!jam3yaDb && sqlite3) {
    const dbName = env.JAM3YA_DB_NAME || '';
    const dbPath = dbName.endsWith('.sqlite') ? dbName : path.join(baseDir, 'dukaazbg_jam3yatKA.sqlite');

    const fs = require('fs');
    if (!fs.existsSync(dbPath)) {
      jam3yaDbError =
        "ملف قاعدة البيانات غير موجود في المسار المتوقع:<br>" +
        dbPath +
        "<br>يرجى التأكد من رفع الملف بالاسم الصحيح.";
      jam3yaDb = null;
    } else {
      jam3yaDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          jam3yaDbError = 'SQLite Connection Failed: ' + err.message;
          jam3yaDb = null;
        } else {
          // Best-effort lightweight migrations
          jam3yaDb.run('ALTER TABLE members ADD COLUMN nickname TEXT', () => {});
          jam3yaDb.run('ALTER TABLE members ADD COLUMN email TEXT', () => {});
          jam3yaDb.run('ALTER TABLE transactions ADD COLUMN is_approved INTEGER DEFAULT 1', () => {});
          jam3yaDb.run('ALTER TABLE transactions ADD COLUMN created_by_member INTEGER DEFAULT 0', () => {});
          jam3yaDb.run('ALTER TABLE obligation_payments ADD COLUMN transaction_id INTEGER', () => {});
          jam3yaDb.run('ALTER TABLE subjects ADD COLUMN type TEXT DEFAULT \'expense\'', () => {});
          jam3yaDb.run(
            'CREATE TABLE IF NOT EXISTS visitors (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, path TEXT, date TEXT, user_agent TEXT, member_name TEXT)',
            (e) => {
              if (!e) jam3yaDb.run('ALTER TABLE visitors ADD COLUMN member_name TEXT', () => {});
            }
          );

          // Auction feature tables
          jam3yaDb.run(`CREATE TABLE IF NOT EXISTS auction_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            image_path TEXT,
            starting_price DECIMAL(10,3) NOT NULL,
            min_increment DECIMAL(10,3) NOT NULL,
            quantity DECIMAL(10,3),
            unit TEXT,
            start_date DATETIME NOT NULL,
            end_date DATETIME NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            linked_transaction_id INTEGER,
            winner_member_id INTEGER,
            winning_bid_id INTEGER,
            winner_bid_amount DECIMAL(10,3),
            awarded_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`, () => {});
          jam3yaDb.run(`CREATE TABLE IF NOT EXISTS auction_bids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            auction_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount DECIMAL(10,3) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`, () => {});
          jam3yaDb.run("INSERT OR IGNORE INTO subjects (name, type) VALUES ('بيع', 'income')", () => {});
        }
      });
    }
  }

  if (!jam3yaDb && !sqlite3 && !jam3yaDbError) {
    jam3yaDbError = 'SQLite3 module missing or disabled';
  }

  return { jam3yaDb, jam3yaDbError, tryMysqlFallback };
}

module.exports = { initJam3ya };
