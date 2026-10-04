const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const { createJam3yaReminders } = require('../services/jam3yaReminders');

function buildJam3yaRouter({ jam3yaDb, jam3yaDbError, getGulfDateString, getGulfDateTimeString, baseUrl }) {
  const router = require('express').Router();

  const { sendQuarterReminders } = createJam3yaReminders({ jam3yaDb, env: process.env });

  // Helper for logging visitors
  const logVisitor = (req, memberName) => {
    if (!jam3yaDb) return;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const p = req.originalUrl;
    const ua = req.get('User-Agent') || '';
    const date = getGulfDateTimeString();
    jam3yaDb.run(
      'INSERT INTO visitors (ip, path, date, user_agent, member_name) VALUES (?, ?, ?, ?, ?)',
      [ip, p, date, ua, memberName],
      (err) => {
        if (err) console.error('Visitor Log Error:', err.message);
      }
    );
  };

  // ------------------------------
  // Auctions: shared helpers
  // ------------------------------
  const auctionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('auction_image');

  const compressAuctionImage = async (fileBuffer) => {
    if (!fileBuffer) return null;
    const filename = `auction-${Date.now()}.webp`;
    const fullPath = path.join(__dirname, '..', 'uploads', filename);
    try {
      await sharp(fileBuffer)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .toFormat('webp', { quality: 80 })
        .toFile(fullPath);
      return filename;
    } catch (err) {
      console.error('Auction image compression error:', err);
      return null;
    }
  };

  const toSqlDateTime = (value) => {
    if (!value) return null;
    const normalized = String(value).trim().replace('T', ' ');
    return normalized.length === 16 ? `${normalized}:00` : normalized;
  };
  const nowSqlDateTime = () => getGulfDateTimeString().replace('T', ' ').slice(0, 19);

  // mysql2 returns DATETIME columns as JS Date objects (built from the raw stored digits via the
  // local Date constructor), while sqlite3 returns them as plain 'YYYY-MM-DD HH:MM:SS' strings.
  // Normalize either shape to the same plain string so every downstream comparison/format call
  // only ever deals with strings.
  const toSqlDateTimeString = (value) => {
    if (!value) return '';
    if (value instanceof Date) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    }
    return String(value);
  };

  const normalizeAuctionDates = (a) => ({
    ...a,
    start_date: toSqlDateTimeString(a.start_date),
    end_date: toSqlDateTimeString(a.end_date),
  });

  const formatArabicShortDateTime = (rawValue) => {
    const sqlStr = toSqlDateTimeString(rawValue);
    if (!sqlStr) return '';
    const [datePart, timePart] = sqlStr.split(' ');
    const dateParts = (datePart || '').split('-');
    if (dateParts.length !== 3) return sqlStr;
    const [y, m, d] = dateParts;
    const timeParts = (timePart || '00:00').split(':');
    const h = parseInt(timeParts[0], 10) || 0;
    const min = timeParts[1] || '00';
    const period = h >= 12 ? 'مساء' : 'صباحا';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    const hh = String(h12).padStart(2, '0');
    return `${d}-${m}-${y}  ${hh}${min} ${period}`;
  };

  const computeEffectiveStatus = (auction, now) => {
    const current = now || nowSqlDateTime();
    if (auction.status === 'published') {
      if (auction.start_date > current) return 'upcoming';
      if (auction.end_date < current) return 'ended';
      return 'active';
    }
    return auction.status;
  };

  const syncEndedAuctions = () =>
    new Promise((resolve) => {
      if (!jam3yaDb) return resolve();
      jam3yaDb.run(
        "UPDATE auction_items SET status = 'ended' WHERE status = 'published' AND end_date < ?",
        [nowSqlDateTime()],
        () => resolve()
      );
    });

  const getAuctionPriceInfo = (auctionId, cb) => {
    jam3yaDb.get(
      'SELECT COUNT(*) AS bid_count, MAX(amount) AS top_bid FROM auction_bids WHERE auction_id = ?',
      [auctionId],
      cb
    );
  };

  const findMemberByPasscode = (rawPasscode, cb) => {
    const passcode = String(rawPasscode || '').trim();
    if (!passcode) return cb(null, null);
    jam3yaDb.get(
      'SELECT * FROM members WHERE passcode = ? AND (is_active = 1 OR is_active IS NULL) LIMIT 1',
      [passcode],
      cb
    );
  };

  const formatShortDateDMY = (rawDate) => {
    const str = toSqlDateTimeString(rawDate).trim();
    const datePart = str.split(/[ T]/)[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return str;
    const [y, m, d] = parts;
    return `${d}-${m}-${y}`;
  };

  // DB availability middleware
  const checkJam3yaDb = (req, res, next) => {
    if (!jam3yaDb || jam3yaDb.initializationError) {
      const errorMsg = jam3yaDb && jam3yaDb.initializationError ? (jam3yaDb.initializationError.message || jam3yaDb.initializationError) : jam3yaDbError;

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(503).json({ success: false, message: "Jam3ya service unavailable (DB connection failed)" });
      }

      return res.status(503).send(`
        <div style="text-align:center; padding:50px; font-family:sans-serif;">
          <h1>عذراً</h1>
          <p>نظام الجمعية غير متاح حالياً بسبب مشكلة في الاتصال بقاعدة البيانات.</p>
          <p style="color:red; direction:ltr; text-align:left; background:#ffe6e6; padding:10px; border-radius:5px;">
            <strong>Error Details:</strong><br>
            ${errorMsg || 'Unknown Error'}
          </p>
          <a href="/">العودة للرئيسية</a>
        </div>
      `);
    }
    next();
  };

  const requireJam3yaAdmin = (req, res, next) => {
    if (!req.session.jam3ya_admin) return res.redirect('/jam3ya/login');
    if (!jam3yaDb) return res.status(503).send('Database Unavailable');
    next();
  };
  const requireJam3yaMember = (req, res, next) => {
    if (!req.session.jam3ya_member) return res.redirect('/jam3ya/login');
    if (!jam3yaDb) return res.status(503).send('Database Unavailable');
    next();
  };

  // Helper to process Jam3ya transactions
  const processJam3yaData = (rows, initialBalance) => {
    let currentBalance = initialBalance;
    let totalIncome = 0;
    let totalExpense = 0;
    const expensesBySubject = {};

    rows.forEach((row) => {
      if (row.date instanceof Date) {
        const gulfOffset = 4 * 60 * 60 * 1000;
        const gulfDate = new Date(row.date.getTime() + gulfOffset);
        const y = gulfDate.getUTCFullYear();
        const m = String(gulfDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(gulfDate.getUTCDate()).padStart(2, '0');
        row.date = `${y}-${m}-${d}`;
      }

      let amount = 0;
      if (typeof row.amount === 'number') amount = row.amount;
      else if (typeof row.amount === 'string') {
        const cleanAmount = row.amount.replace(/٫/g, '.').replace(/,/g, '.');
        amount = parseFloat(cleanAmount) || 0;
      }
      row.amount = amount;

      const isApproved = row.is_approved === undefined || row.is_approved === null ? 1 : row.is_approved;
      const effectiveAmount = isApproved ? amount : 0;

      currentBalance += effectiveAmount;
      row.balance = currentBalance.toFixed(3);

      if (effectiveAmount > 0) totalIncome += effectiveAmount;
      else totalExpense += Math.abs(effectiveAmount);

      if (row.subject) {
        if (!expensesBySubject[row.subject]) {
          expensesBySubject[row.subject] = { name: row.subject, total: 0, transactions: [], lastDate: row.date || '' };
        }
        expensesBySubject[row.subject].total += effectiveAmount;
        expensesBySubject[row.subject].transactions.push(row);
        if (row.date && row.date > expensesBySubject[row.subject].lastDate) expensesBySubject[row.subject].lastDate = row.date;
      }
    });

    const subjectsList = Object.values(expensesBySubject).sort((a, b) => (b.lastDate < a.lastDate ? -1 : b.lastDate > a.lastDate ? 1 : 0));
    subjectsList.forEach((s) => s.transactions.reverse());

    return {
      transactions: [...rows].reverse(),
      subjectsList,
      totalIncome,
      totalExpense,
      currentBalance,
      initialBalance,
    };
  };

  async function updatePublicExcelFile() {
    return new Promise((resolve) => {
      if (!jam3yaDb) return resolve();
      jam3yaDb.serialize(() => {
        jam3yaDb.all('SELECT * FROM transactions ORDER BY date ASC, id ASC', (err, rows) => {
          if (err) return resolve();
          jam3yaDb.all('SELECT member_code, name FROM members', (mErr, members) => {
            if (mErr) return resolve();

            const nameToCode = {};
            (members || []).forEach((m) => {
              const code = String(m.member_code).trim();
              const name = String(m.name).trim();
              nameToCode[name] = code;
            });

            processJam3yaData(rows || [], 0);

            const newestFirst = (rows || [])
              .map((t) => {
                const rawItem = t.item != null ? String(t.item).trim() : '';
                let displayItem = rawItem;
                if (nameToCode[rawItem]) displayItem = nameToCode[rawItem];
                return { date: t.date, subject: t.subject, item: displayItem, details: t.details || '', amount: t.amount, balance: t.balance };
              })
              .reverse();

            const data = [['التسلسل', 'التاريخ', 'الموضوع', 'البند', 'التفاصيل', 'القيمة', 'المجموع التراكمي']];
            newestFirst.forEach((t, idx) => {
              data.push([
                idx + 1,
                t.date,
                t.subject,
                t.item,
                t.details,
                typeof t.amount === 'number' ? Number(t.amount.toFixed(3)) : t.amount,
                typeof t.balance === 'string' ? Number(parseFloat(t.balance).toFixed(3)) : t.balance,
              ]);
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

            const publicPath = path.join(process.cwd(), 'public', 'jam3ya_transactions.xlsx');
            const timestampPath = path.join(process.cwd(), 'public', 'jam3ya_transactions_date.txt');

            try {
              XLSX.writeFile(wb, publicPath);
              const timestamp = Math.floor(Date.now() / 1000).toString();
              require('fs').writeFileSync(timestampPath, timestamp);
            } catch (e) {
              console.error('Error writing public Excel/Timestamp file:', e);
            }
            resolve();
          });
        });
      });
    });
  }

  // Routes
  router.get('/login', async (req, res) => {
    let activeAuctions = [];
    if (jam3yaDb && !jam3yaDb.initializationError) {
      try {
        await syncEndedAuctions();
        const rows = await new Promise((resolve, reject) =>
          jam3yaDb.all(
            "SELECT * FROM auction_items WHERE status IN ('published','ended') ORDER BY end_date ASC",
            [],
            (err, result) => (err ? reject(err) : resolve(result || []))
          )
        );
        const now = nowSqlDateTime();
        const visible = rows
          .map(normalizeAuctionDates)
          .map((a) => ({ ...a, effective_status: computeEffectiveStatus(a, now) }))
          .filter((a) => a.effective_status === 'upcoming' || a.effective_status === 'active');

        activeAuctions = await Promise.all(
          visible.map(
            (a) =>
              new Promise((resolve) => {
                getAuctionPriceInfo(a.id, (err, priceRow) => {
                  const currentPrice =
                    !err && priceRow && priceRow.top_bid != null ? Number(priceRow.top_bid) : Number(a.starting_price);
                  resolve({
                    ...a,
                    current_price: currentPrice,
                    bid_count: !err && priceRow ? priceRow.bid_count : 0,
                    start_date_display: formatArabicShortDateTime(a.start_date),
                    end_date_display: formatArabicShortDateTime(a.end_date),
                  });
                });
              })
          )
        );
      } catch (err) {
        console.error('Load public auctions error:', err);
        activeAuctions = [];
      }
    }
    res.render('jam3ya-login', { error: null, layout: false, isAdmin: false, activeAuctions });
  });

  router.post('/login', checkJam3yaDb, (req, res) => {
    const { passcode } = req.body;
    const masterPass = process.env.JAM3YA_ADMIN_PASS || '123456';

    if (passcode === masterPass) {
      req.session.jam3ya_admin = true;
      logVisitor(req, 'مدير النظام (Master)');
      return res.redirect('/jam3ya/dashboard');
    }

    jam3yaDb.get('SELECT * FROM members WHERE passcode = ?', [passcode], (err, row) => {
      if (err) return res.render('jam3ya-login', { error: 'حدث خطأ في النظام', layout: false, isAdmin: false });
      if (!row) return res.render('jam3ya-login', { error: 'الرمز السري غير صحيح', layout: false, isAdmin: false });

      if (row.is_admin === 1) {
        req.session.temp_jam3ya_user = row;
        return res.render('jam3ya-role-select', { name: row.name, layout: false });
      }

      req.session.jam3ya_member = true;
      req.session.jam3ya_member_id = row.id;
      req.session.jam3ya_member_name = row.name;
      req.session.jam3ya_member_code = row.member_code;

      logVisitor(req, row.name);
      req.session.save(() => res.redirect('/jam3ya'));
    });
  });

  router.post('/login/confirm', (req, res) => {
    const user = req.session.temp_jam3ya_user;
    const { role } = req.body;
    if (!user) return res.redirect('/jam3ya/login');

    if (role === 'admin') {
      req.session.jam3ya_admin = true;
      req.session.jam3ya_admin_id = user.id;
      req.session.jam3ya_admin_name = user.name;
    } else {
      req.session.jam3ya_member = true;
      req.session.jam3ya_member_id = user.id;
      req.session.jam3ya_member_name = user.name;
      req.session.jam3ya_member_code = user.member_code;
    }

    logVisitor(req, user.name + (role === 'admin' ? ' (Admin Access)' : ''));
    delete req.session.temp_jam3ya_user;

    req.session.save(() => {
      if (role === 'admin') res.redirect('/jam3ya/dashboard');
      else res.redirect('/jam3ya');
    });
  });

  router.get('/logout', (req, res) => {
    req.session.jam3ya_admin = false;
    req.session.jam3ya_member = false;
    req.session.jam3ya_member_id = null;
    req.session.jam3ya_member_name = null;
    req.session.jam3ya_member_code = null;
    res.redirect('/jam3ya');
  });

  router.get('/', checkJam3yaDb, async (req, res) => {
    try {
      let memberId = req.session.jam3ya_member_id;
      let memberCode = req.session.jam3ya_member_code;
      let memberName = req.session.jam3ya_member_name;
      const isAdmin = !!req.session.jam3ya_admin;
      const adminName = req.session.jam3ya_admin_name || 'مدير النظام';

      if (!memberId && !isAdmin) return res.redirect('/jam3ya/login');

      const allTransactionsPromise = new Promise((resolve, reject) => {
        jam3yaDb.all('SELECT * FROM transactions ORDER BY date ASC, id ASC', [], (err, rows) => (err ? reject(err) : resolve(rows)));
      });

      const infoMessagesPromise = new Promise((resolve) => {
        jam3yaDb.all('SELECT * FROM info_messages ORDER BY created_at DESC', [], (err, rows) => resolve(err ? [] : rows || []));
      });

      let memberTransactionsPromise = Promise.resolve(null);
      if (memberCode) {
        memberTransactionsPromise = new Promise((resolve, reject) => {
          jam3yaDb.all('SELECT * FROM transactions WHERE item = ? ORDER BY date ASC, id ASC', [memberCode], (err, rows) => (err ? reject(err) : resolve(rows)));
        });
      }

      const obligationsPromise = new Promise((resolve) => {
        jam3yaDb.all(
          "SELECT o.id, o.subject, o.description, o.total_amount, COALESCE(SUM(p.amount), 0) AS paid_amount FROM obligations o LEFT JOIN obligation_payments p ON p.obligation_id = o.id GROUP BY o.id ORDER BY o.id DESC",
          (err, rows) => {
            if (err || !rows) return resolve([]);
            resolve(
              rows.map((o) => {
                const paid = Number(o.paid_amount || 0);
                const total = Number(o.total_amount || 0);
                const remaining = total - paid;
                let status = 'open';
                if (paid <= 0) status = 'open';
                else if (remaining > 0) status = 'partial';
                else status = 'settled';
                return { id: o.id, subject: o.subject, description: o.description, total_amount: total, paid_amount: paid, remaining_amount: remaining, status };
              })
            );
          }
        );
      });

      const [allRows, memberRows, infoMessages, obligations] = await Promise.all([allTransactionsPromise, memberTransactionsPromise, infoMessagesPromise, obligationsPromise]);

      const mainData = processJam3yaData(allRows || [], 0);
      const memberData = memberRows ? processJam3yaData(memberRows, 0) : null;

      let membersList = [];
      await new Promise((resolve) => {
        jam3yaDb.all('SELECT id, member_code, name, nickname FROM members ORDER BY name ASC', (err, rows) => {
          if (!err && rows) membersList = rows;
          resolve();
        });
      });

      res.render('jam3ya', {
        title: 'جمعية الخطوة الأهلية',
        mainData,
        memberData,
        infoMessages,
        isLoggedIn: !!memberId,
        memberId: memberCode,
        memberName,
        isAdmin,
        adminName,
        membersList,
        obligations,
        layout: false,
      });
    } catch (err) {
      console.error('Jam3ya Page Error:', err);
      res.status(500).send('Database Error');
    }
  });

  // Minimal admin transaction routes (kept here; you can extend the rest similarly)
  router.post('/transactions/add', requireJam3yaAdmin, (req, res) => {
    const { date, type, subject, member_id, description, details, amount, obligation_id } = req.body;
    const targetDate = date || getGulfDateString();
    let finalAmount = parseFloat(amount);
    if (type === 'expense') finalAmount = -Math.abs(finalAmount);
    else finalAmount = Math.abs(finalAmount);

    const normalizedObligationId = Number(obligation_id);
    const hasObligationLink = Number.isInteger(normalizedObligationId) && normalizedObligationId > 0;

    const finalizeWithRedirect = async () => {
      await updatePublicExcelFile();
      res.redirect('/jam3ya/dashboard?tab=transactions');
    };

    const linkTransactionToObligation = (transactionId, done) => {
      if (!hasObligationLink) return done();

      const paymentAmount = Math.abs(finalAmount);
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return done();

      const paymentDate = targetDate || getGulfDateString();
      const createdAt = getGulfDateTimeString();

      const attempts = [
        {
          sql: 'INSERT INTO obligation_payments (obligation_id, amount, transaction_id) VALUES (?, ?, ?)',
          params: [normalizedObligationId, paymentAmount, transactionId],
        },
        {
          sql: 'INSERT INTO obligation_payments (obligation_id, amount, payment_date, transaction_id) VALUES (?, ?, ?, ?)',
          params: [normalizedObligationId, paymentAmount, paymentDate, transactionId],
        },
        {
          sql: 'INSERT INTO obligation_payments (obligation_id, amount, payment_date) VALUES (?, ?, ?)',
          params: [normalizedObligationId, paymentAmount, paymentDate],
        },
        {
          sql: 'INSERT INTO obligation_payments (obligation_id, amount, created_at, transaction_id) VALUES (?, ?, ?, ?)',
          params: [normalizedObligationId, paymentAmount, createdAt, transactionId],
        },
        {
          sql: 'INSERT INTO obligation_payments (obligation_id, amount, created_at) VALUES (?, ?, ?)',
          params: [normalizedObligationId, paymentAmount, createdAt],
        },
        {
          sql: 'INSERT INTO obligation_payments (obligation_id, amount) VALUES (?, ?)',
          params: [normalizedObligationId, paymentAmount],
        },
      ];

      const tryInsert = (index, lastError) => {
        if (index >= attempts.length) return done(lastError || new Error('Failed to insert obligation payment'));

        const attempt = attempts[index];
        jam3yaDb.run(attempt.sql, attempt.params, (err) => {
          if (!err) return done();
          console.error('Obligation payment insert attempt failed:', {
            obligationId: normalizedObligationId,
            transactionId,
            sql: attempt.sql,
            error: err && err.message ? err.message : err,
          });
          tryInsert(index + 1, err);
        });
      };

      tryInsert(0, null);
    };

    const processTransaction = (itemValue) => {
      jam3yaDb.run(
        'INSERT INTO transactions (date, subject, item, details, amount, balance, is_approved, created_by_member) VALUES (?, ?, ?, ?, ?, 0, 1, 0)',
        [targetDate, subject, itemValue, details, finalAmount],
        async function (err) {
          if (err) return res.status(500).send('Error adding transaction');
          const transactionId = this.lastID;

          linkTransactionToObligation(transactionId, async (linkErr) => {
            if (linkErr) console.error('Link Obligation Payment Error:', linkErr);
            await finalizeWithRedirect();
          });
        }
      );
    };

    if (member_id) {
      jam3yaDb.get('SELECT member_code FROM members WHERE id = ?', [member_id], (err, row) => {
        if (err || !row) return res.status(404).send('Member not found');
        processTransaction(row.member_code);
      });
    } else {
      processTransaction(description || '');
    }
  });

  router.post('/transactions/submit', requireJam3yaMember, (req, res) => {
    const { target_member_code, year, amount } = req.body;
    const subject = 'مساهمات الاعضاء';
    const targetDate = getGulfDateString();
    const finalAmount = Math.abs(parseFloat(amount));
    const details = year ? String(year) : '';

    const insertForCode = (code) => {
      jam3yaDb.run(
        'INSERT INTO transactions (date, subject, item, details, amount, balance, is_approved, created_by_member) VALUES (?, ?, ?, ?, ?, 0, 0, 1)',
        [targetDate, subject, code, details, finalAmount],
        async (err) => {
          if (err) return res.status(500).send('Error submitting transaction');
          await updatePublicExcelFile();
          res.redirect('/jam3ya');
        }
      );
    };

    if (target_member_code) {
      jam3yaDb.get('SELECT member_code FROM members WHERE member_code = ?', [target_member_code], (err, row) => {
        if (err || !row) return res.status(404).send('Member code not found');
        insertForCode(row.member_code);
      });
    } else {
      const ownCode = req.session.jam3ya_member_code;
      if (!ownCode) return res.status(403).send('Session member code missing');
      insertForCode(ownCode);
    }
  });

  // -----------------------------
  // Admin: transactions workflow
  // -----------------------------
  router.post('/transactions/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.serialize(() => {
      jam3yaDb.run('DELETE FROM obligation_payments WHERE transaction_id = ?', [id], (payErr) => {
        if (payErr) console.error('Obligation Payment Delete Error:', payErr);
        jam3yaDb.run('DELETE FROM transactions WHERE id = ?', [id], async (err) => {
          if (err) return res.status(500).send('Error deleting transaction');
          await updatePublicExcelFile();
          res.redirect('/jam3ya/dashboard?tab=transactions');
        });
      });
    });
  });

  router.post('/transactions/approve', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('UPDATE transactions SET is_approved = 1 WHERE id = ?', [id], async (err) => {
      if (err) return res.status(500).send('Error approving transaction');
      await updatePublicExcelFile();
      res.redirect('/jam3ya/dashboard?tab=transactions');
    });
  });

  router.post('/transactions/edit', requireJam3yaAdmin, (req, res) => {
    const { id, date, type, subject, member_id, description, details, amount } = req.body;
    const targetDate = date || getGulfDateString();
    let finalAmount = parseFloat(amount);
    if (type === 'expense') finalAmount = -Math.abs(finalAmount);
    else finalAmount = Math.abs(finalAmount);

    const doUpdate = (itemValue) => {
      jam3yaDb.run(
        'UPDATE transactions SET date = ?, subject = ?, item = ?, details = ?, amount = ? WHERE id = ?',
        [targetDate, subject, itemValue, details || '', finalAmount, id],
        async (err) => {
          if (err) return res.status(500).send('Error updating transaction');
          await updatePublicExcelFile();
          res.redirect('/jam3ya/dashboard?tab=transactions');
        }
      );
    };

    if (member_id) {
      jam3yaDb.get('SELECT member_code FROM members WHERE id = ?', [member_id], (err, row) => {
        if (err || !row) return res.status(404).send('Member not found');
        doUpdate(row.member_code);
      });
    } else {
      doUpdate(description || '');
    }
  });

  // -----------------------------
  // Admin: dashboard
  // -----------------------------
  router.get('/dashboard', requireJam3yaAdmin, (req, res) => {
    const adminName = req.session.jam3ya_admin_name || 'مدير النظام';

    const dbAll = (sql, params = []) =>
      new Promise((resolve, reject) => {
        jam3yaDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
      });

    jam3yaDb.serialize(async () => {
      try {
        const members = await dbAll('SELECT * FROM members ORDER BY name ASC');

        let subjects = [];
        try {
          subjects = await dbAll('SELECT * FROM subjects ORDER BY name ASC');
        } catch (err) {
          subjects = [];
        }

        let infoMessages = [];
        try {
          infoMessages = await dbAll('SELECT * FROM info_messages ORDER BY created_at DESC');
        } catch (err) {
          infoMessages = [];
        }

        const transactions = await dbAll('SELECT * FROM transactions ORDER BY date ASC, id ASC');

        const recentSubjects = [];
        const seenSubjects = new Set();
        [...transactions]
          .reverse()
          .forEach((t) => {
            const subjectName = String(t.subject || '').trim();
            if (!subjectName || seenSubjects.has(subjectName)) return;
            seenSubjects.add(subjectName);
            recentSubjects.push(subjectName);
          });
        const activeSubjects = recentSubjects.slice(0, 4).map((name) => {
          const subj = subjects.find((s) => s.name === name);
          return { name, type: subj ? (subj.type || 'expense') : 'expense' };
        });

        const mainData = processJam3yaData(transactions, 0);

        let obligationsRows = [];
        try {
          obligationsRows = await dbAll(
            'SELECT o.id, o.subject, o.description, o.total_amount, COALESCE(SUM(p.amount), 0) AS paid_amount FROM obligations o LEFT JOIN obligation_payments p ON p.obligation_id = o.id GROUP BY o.id ORDER BY o.id DESC'
          );
        } catch (err) {
          obligationsRows = [];
        }

        const obligations = (obligationsRows || []).map((o) => {
          const paid = Number(o.paid_amount || 0);
          const total = Number(o.total_amount || 0);
          const remaining = total - paid;
          let status = 'open';
          if (paid <= 0) status = 'open';
          else if (remaining > 0) status = 'partial';
          else status = 'settled';
          return {
            id: o.id,
            subject: o.subject,
            description: o.description,
            total_amount: total,
            paid_amount: paid,
            remaining_amount: remaining,
            status,
          };
        });

        let visitors = [];
        try {
          visitors = await dbAll('SELECT * FROM visitors ORDER BY id DESC LIMIT 200');
        } catch (err) {
          visitors = [];
        }

        const memberMap = {};
        const memberIdMap = {};
        (members || []).forEach((m) => {
          memberMap[m.member_code] = m.name;
          memberIdMap[m.id] = m.name;
        });

        const processedTransactions = (transactions || [])
          .map((t) => {
            let displayItem = t.item;
            let isMember = false;
            if (memberMap[t.item]) {
              displayItem = memberMap[t.item];
              isMember = true;
            }
            return { ...t, displayItem, isMember };
          })
          .reverse();

        const currentYear = new Date().getFullYear().toString();
        const targetYear = String(req.query.unpaid_year || currentYear);
        const paidMemberCodes = new Set();
        const paymentReport = {};
        const yearsSet = new Set(['2023', '2024', currentYear, targetYear]);

        (transactions || []).forEach((t) => {
          let dateStr = t.date;
          if (t.date instanceof Date) dateStr = t.date.toISOString().split('T')[0];
          else dateStr = String(t.date);
          t.date = dateStr;

          const subject = String(t.subject || '').trim();
          const item = String(t.item || '').trim();
          let details = String(t.details || '');
          details = details.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

          if (subject === 'مساهمات الاعضاء') {
            const yearsInDetails = details.match(/\b20\d{2}\b/g);
            let coveredYears = [];
            if (yearsInDetails && yearsInDetails.length > 0) coveredYears = yearsInDetails;
            else if (dateStr) coveredYears = [dateStr.split('-')[0]];

            if (!paymentReport[item]) paymentReport[item] = {};
            coveredYears.forEach((year) => {
              if (year >= '2023') {
                yearsSet.add(year);
                if (!paymentReport[item][year]) paymentReport[item][year] = 0;
                const amountPerYear = Number(t.amount || 0) / coveredYears.length;
                paymentReport[item][year] += amountPerYear;
              }
            });

            let isPaidForTargetYear = false;
            if (yearsInDetails && yearsInDetails.length > 0) {
              if (yearsInDetails.includes(targetYear)) isPaidForTargetYear = true;
            } else if (dateStr && dateStr.startsWith(targetYear)) {
              isPaidForTargetYear = true;
            }
            if (isPaidForTargetYear) paidMemberCodes.add(item);
          }
        });

        const sortedYears = Array.from(yearsSet).sort();
        const yearlyTotals = {};
        sortedYears.forEach((year) => (yearlyTotals[year] = 0));
        Object.entries(paymentReport).forEach(([, memberPayments]) => {
          for (const [year, amount] of Object.entries(memberPayments)) {
            if (yearlyTotals[year] !== undefined) yearlyTotals[year] += amount;
          }
        });

        const unpaidMembers = (members || []).filter((m) => {
          const memberCode = String(m.member_code || '').trim();
          const isActive = m.is_active == 1 || m.is_active == null;
          if (!isActive) return false;
          if (paidMemberCodes.has(memberCode)) return false;
          return true;
        });

        let auctions = [];
        try {
          await syncEndedAuctions();
          const auctionRows = (await dbAll('SELECT * FROM auction_items ORDER BY created_at DESC')).map(normalizeAuctionDates);
          const now = nowSqlDateTime();
          auctions = await Promise.all(
            auctionRows.map(
              (a) =>
                new Promise((resolve) => {
                  getAuctionPriceInfo(a.id, (err, priceRow) => {
                    const currentPrice =
                      !err && priceRow && priceRow.top_bid != null ? Number(priceRow.top_bid) : Number(a.starting_price);
                    resolve({
                      ...a,
                      current_price: currentPrice,
                      bid_count: !err && priceRow ? priceRow.bid_count : 0,
                      effective_status: computeEffectiveStatus(a, now),
                      start_date_display: formatArabicShortDateTime(a.start_date),
                      end_date_display: formatArabicShortDateTime(a.end_date),
                      winner_name: a.winner_member_id ? (memberIdMap[a.winner_member_id] || null) : null,
                    });
                  });
                })
            )
          );
        } catch (err) {
          console.error('Load auctions for dashboard error:', err);
          auctions = [];
        }

        let recentTransactionsForAuctionLink = [];
        try {
          const linkRows = await dbAll(
            "SELECT id, date, subject, item, details FROM transactions WHERE amount < 0 AND subject NOT LIKE '%فاتور%' AND subject NOT LIKE '%فواتير%' ORDER BY date DESC, id DESC LIMIT 100"
          );
          recentTransactionsForAuctionLink = linkRows.map((t) => {
            const displayItem = memberMap[t.item] || t.item || '';
            const shortDate = formatShortDateDMY(t.date);
            const labelParts = [shortDate, t.subject, displayItem].filter(Boolean);
            if (t.details) labelParts.push(t.details);
            return { id: t.id, label: labelParts.join(' - '), details: t.details || '' };
          });
        } catch (err) {
          recentTransactionsForAuctionLink = [];
        }

        const serverNowForView = nowSqlDateTime().slice(0, 16).replace(' ', 'T');

        res.render('jam3ya-dashboard', {
          members,
          subjects,
          activeSubjects,
          transactions: processedTransactions,
          unpaidMembers,
          targetYear,
          paymentReport,
          yearlyTotals,
          sortedYears,
          obligations,
          mainData,
          adminName,
          visitors,
          infoMessages,
          auctions,
          recentTransactionsForAuctionLink,
          serverNowForView,
          layout: false,
        });
      } catch (err) {
        console.error('Jam3ya Dashboard Error:', err);
        res.status(500).send('Database Error');
      }
    });
  });

  // -----------------------------
  // Admin: export
  // -----------------------------
  router.get('/export/excel', requireJam3yaAdmin, (req, res) => {
    jam3yaDb.serialize(() => {
      jam3yaDb.all('SELECT * FROM transactions ORDER BY date ASC, id ASC', (err, rows) => {
        if (err) return res.status(500).send('DB Error (Transactions): ' + err.message);
        jam3yaDb.all('SELECT member_code, name FROM members', (mErr, members) => {
          if (mErr) return res.status(500).send('DB Error (Members): ' + mErr.message);
          const codeToName = {};
          const nameToCode = {};
          (members || []).forEach((m) => {
            const code = String(m.member_code).trim();
            const name = String(m.name).trim();
            codeToName[code] = name;
            nameToCode[name] = code;
          });
          processJam3yaData(rows || [], 0);
          const modeParam = String(req.query.mode || '').toLowerCase();
          const mode = modeParam === 'names' ? 'names' : 'codes';
          const newestFirst = (rows || [])
            .map((t) => {
              const rawItem = t.item != null ? String(t.item).trim() : '';
              let displayItem = rawItem;
              if (mode === 'names' && codeToName[rawItem]) displayItem = codeToName[rawItem];
              else if (mode === 'codes' && nameToCode[rawItem]) displayItem = nameToCode[rawItem];
              return { date: t.date, subject: t.subject, item: displayItem, details: t.details || '', amount: t.amount, balance: t.balance };
            })
            .reverse();

          const data = [['التسلسل', 'التاريخ', 'الموضوع', 'البند', 'التفاصيل', 'القيمة', 'المجموع التراكمي']];
          newestFirst.forEach((t, idx) => {
            data.push([
              idx + 1,
              t.date,
              t.subject,
              t.item,
              t.details,
              typeof t.amount === 'number' ? Number(t.amount.toFixed(3)) : t.amount,
              typeof t.balance === 'string' ? Number(parseFloat(t.balance).toFixed(3)) : t.balance,
            ]);
          });

          const wb = XLSX.utils.book_new();
          const ws = XLSX.utils.aoa_to_sheet(data);
          XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
          const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="jam3ya-transactions.xlsx"');
          res.send(buf);
        });
      });
    });
  });

  router.get('/export/pdf', requireJam3yaAdmin, (req, res) => {
    jam3yaDb.serialize(() => {
      jam3yaDb.all('SELECT * FROM transactions ORDER BY date ASC, id ASC', (err, rows) => {
        if (err) return res.status(500).send('DB Error (Transactions): ' + err.message);
        jam3yaDb.all('SELECT member_code, name FROM members', (mErr, members) => {
          if (mErr) return res.status(500).send('DB Error (Members): ' + mErr.message);
          const codeToName = {};
          const nameToCode = {};
          (members || []).forEach((m) => {
            const code = String(m.member_code).trim();
            const name = String(m.name).trim();
            codeToName[code] = name;
            nameToCode[name] = code;
          });
          processJam3yaData(rows || [], 0);
          const modeParam = String(req.query.mode || '').toLowerCase();
          const mode = modeParam === 'names' ? 'names' : 'codes';

          const newestFirst = (rows || [])
            .map((t) => {
              const rawItem = t.item != null ? String(t.item).trim() : '';
              let displayItem = rawItem;
              if (mode === 'names' && codeToName[rawItem]) displayItem = codeToName[rawItem];
              else if (mode === 'codes' && nameToCode[rawItem]) displayItem = nameToCode[rawItem];
              return { date: t.date, subject: t.subject, item: displayItem, details: t.details || '', amount: t.amount, balance: t.balance };
            })
            .reverse();

          const rowsHtml = newestFirst
            .map(
              (t, idx) => `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td>${t.date || '-'}</td>
                <td>${t.subject || '-'}</td>
                <td>${t.item || '-'}</td>
                <td>${t.details || '-'}</td>
                <td dir="ltr" style="text-align:right;">${(typeof t.amount === 'number' ? t.amount.toFixed(3) : t.amount) || '0.000'}</td>
                <td dir="ltr" style="text-align:right;">${(typeof t.balance === 'string' ? parseFloat(t.balance).toFixed(3) : (t.balance || 0)).toString()}</td>
              </tr>
            `
            )
            .join('');

          const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تصدير PDF - جمعية الخطوة الأهلية</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 30px; color: #333; }
    h2 { margin-top: 0; color: #2c3e50; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #ddd; padding: 8px; white-space: normal; word-break: break-word; overflow-wrap: break-word; }
    th { background: #f2f6fa; color: #2c3e50; }
    .meta { margin-bottom: 10px; color: #666; font-size: 0.95rem; }
    @media print { .no-print { display: none; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 10px;">
    <button onclick="window.print()" style="padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#f7f7f7;cursor:pointer;">طباعة / حفظ PDF</button>
  </div>
  <h2>تقرير العمليات المالية</h2>
  <div class="meta">مرتب بالتاريخ من الأحدث للأقدم</div>
  <table>
    <colgroup>
      <col style="width:6%;">
      <col style="width:10%;">
      <col style="width:15%;">
      <col style="width:20%;">
      <col style="width:29%;">
      <col style="width:10%;">
      <col style="width:10%;">
    </colgroup>
    <thead>
      <tr>
        <th>التسلسل</th>
        <th>التاريخ</th>
        <th>الموضوع</th>
        <th>البند</th>
        <th>التفاصيل</th>
        <th>القيمة</th>
        <th>المجموع التراكمي</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
          res.send(html);
        });
      });
    });
  });

  // -----------------------------
  // Admin: info messages
  // -----------------------------
  router.post('/info-messages/save', requireJam3yaAdmin, (req, res) => {
    const { id, message, display_until } = req.body;
    if (id) {
      jam3yaDb.run('UPDATE info_messages SET message = ?, display_until = ? WHERE id = ?', [message, display_until, id], (err) => {
        if (err) console.error('Info Message Update Error:', err);
        res.redirect('/jam3ya/dashboard?tab=info-messages');
      });
    } else {
      jam3yaDb.run('INSERT INTO info_messages (message, display_until) VALUES (?, ?)', [message, display_until], (err) => {
        if (err) console.error('Info Message Add Error:', err);
        res.redirect('/jam3ya/dashboard?tab=info-messages');
      });
    }
  });

  router.post('/info-messages/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('DELETE FROM info_messages WHERE id = ?', [id], (err) => {
      if (err) console.error('Info Message Delete Error:', err);
      res.redirect('/jam3ya/dashboard?tab=info-messages');
    });
  });

  // -----------------------------
  // Admin: members
  // -----------------------------
  router.post('/members/save', requireJam3yaAdmin, (req, res) => {
    const { id, member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin } = req.body;
    const isActiveVal = is_active ? 1 : 0;
    const isAdminVal = is_admin ? 1 : 0;

    if (id) {
      let sql = 'UPDATE members SET member_code = ?, name = ?, nickname = ?, phone = ?, email = ?, is_active = ?, notes = ?, is_admin = ?';
      const params = [member_code, name, nickname, phone, email, isActiveVal, notes, isAdminVal];
      if (passcode && String(passcode).trim() !== '') {
        sql += ', passcode = ?';
        params.push(passcode);
      }
      sql += ' WHERE id = ?';
      params.push(id);
      jam3yaDb.run(sql, params, (err) => {
        if (err) console.error(err);
        res.redirect('/jam3ya/dashboard?tab=members');
      });
    } else {
      let finalPasscode = passcode;
      if (!finalPasscode) {
        const chars = 'abcdefghijklmnopqrstuvwxyz';
        let suffix = '';
        for (let i = 0; i < 2; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
        finalPasscode = (phone || '') + suffix;
      }

      if (member_code && String(member_code).trim() !== '') {
        jam3yaDb.run(
          'INSERT INTO members (member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [member_code, name, nickname, phone, email, finalPasscode, isActiveVal, notes, isAdminVal],
          (err) => {
            if (err) console.error(err);
            res.redirect('/jam3ya/dashboard?tab=members');
          }
        );
      } else {
        jam3yaDb.get('SELECT MAX(CAST(member_code AS INTEGER)) as maxCode FROM members', (err, row) => {
          if (err) return res.status(500).send('DB Error');
          const nextCode = row && row.maxCode ? row.maxCode + 1 : 1200;
          jam3yaDb.run(
            'INSERT INTO members (member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [String(nextCode), name, nickname, phone, email, finalPasscode, isActiveVal, notes, isAdminVal],
            (e) => {
              if (e) console.error(e);
              res.redirect('/jam3ya/dashboard?tab=members');
            }
          );
        });
      }
    }
  });

  router.post('/members/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('DELETE FROM members WHERE id = ?', [id], (err) => {
      if (err) console.error(err);
      res.redirect('/jam3ya/dashboard?tab=members');
    });
  });

  // -----------------------------
  // Admin: subjects
  // -----------------------------
  router.post('/subjects/add', requireJam3yaAdmin, (req, res) => {
    const { name, type } = req.body;
    const subjectType = type === 'income' ? 'income' : 'expense';
    jam3yaDb.run('INSERT INTO subjects (name, type) VALUES (?, ?)', [name, subjectType], (err) => {
      if (err) console.error(err);
      res.redirect('/jam3ya/dashboard?tab=subjects');
    });
  });

  router.post('/subjects/edit', requireJam3yaAdmin, (req, res) => {
    const { id, name, old_name, type } = req.body;
    const subjectType = type === 'income' ? 'income' : 'expense';
    jam3yaDb.run('UPDATE subjects SET name = ?, type = ? WHERE id = ?', [name, subjectType, id], (err) => {
      if (err) return res.status(500).send('Error updating subject');
      if (old_name && old_name !== name) {
        jam3yaDb.run('UPDATE transactions SET subject = ? WHERE subject = ?', [name, old_name], () => {
          res.redirect('/jam3ya/dashboard?tab=subjects');
        });
      } else {
        res.redirect('/jam3ya/dashboard?tab=subjects');
      }
    });
  });

  router.post('/subjects/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('DELETE FROM subjects WHERE id = ?', [id], (err) => {
      if (err) console.error(err);
      res.redirect('/jam3ya/dashboard?tab=subjects');
    });
  });

  // -----------------------------
  // Admin: obligations
  // -----------------------------
  router.post('/obligations/add', requireJam3yaAdmin, (req, res) => {
    const { subject, description, notes, total_amount } = req.body;
    const amount = parseFloat(total_amount);
    if (!subject || isNaN(amount) || amount <= 0) return res.status(400).send('Invalid obligation data');

    let finalDescription = description || '';
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : '';
    if (trimmedNotes) {
      if (finalDescription) finalDescription += '\n';
      finalDescription += 'ملاحظات: ' + trimmedNotes;
    }

    jam3yaDb.run('INSERT INTO obligations (subject, description, total_amount) VALUES (?, ?, ?)', [subject.trim(), finalDescription || null, amount], (err) => {
      if (err) return res.status(500).send('Error adding obligation');
      res.redirect('/jam3ya/dashboard');
    });
  });

  router.post('/obligations/edit', requireJam3yaAdmin, (req, res) => {
    const { id, subject, description, notes, total_amount } = req.body;
    const amount = parseFloat(total_amount);
    if (!id || !subject || isNaN(amount) || amount <= 0) return res.status(400).send('Invalid obligation data');

    let finalDescription = description || '';
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : '';
    if (trimmedNotes) {
      if (finalDescription) finalDescription += '\n';
      finalDescription += 'ملاحظات: ' + trimmedNotes;
    }

    jam3yaDb.run('UPDATE obligations SET subject = ?, description = ?, total_amount = ? WHERE id = ?', [subject.trim(), finalDescription || null, amount, id], (err) => {
      if (err) return res.status(500).send('Error updating obligation');
      res.redirect('/jam3ya/dashboard');
    });
  });

  router.post('/reminders/send', requireJam3yaAdmin, async (req, res) => {
    try {
  await sendQuarterReminders();
      res.redirect('/jam3ya/dashboard?success=reminders_started&tab=unpaid');
    } catch (err) {
      // Keep UX same; show dashboard with error flag
      console.error('Manual Reminder Error:', err);
      res.redirect('/jam3ya/dashboard?error=reminder_failed&tab=unpaid');
    }
  });

  // ------------------------------
  // Auctions: admin management
  // ------------------------------
  router.post('/auctions/save', requireJam3yaAdmin, checkJam3yaDb, auctionUpload, async (req, res) => {
    try {
      const {
        id, title, description, starting_price, min_increment,
        quantity, unit, start_date, end_date, status, linked_transaction_id,
      } = req.body;

      if (!title || !starting_price || !min_increment || !start_date || !end_date) {
        return res.redirect('/jam3ya/dashboard?tab=auctions&error=missing_fields');
      }

      const allowedStatus = ['draft', 'published', 'cancelled'];
      const finalStatus = allowedStatus.includes(status) ? status : 'draft';
      const auctionId = id ? Number(id) : null;

      let image_path = null;
      if (auctionId) {
        const existing = await new Promise((resolve, reject) =>
          jam3yaDb.get('SELECT image_path FROM auction_items WHERE id = ?', [auctionId], (err, row) =>
            err ? reject(err) : resolve(row)
          )
        );
        if (existing) image_path = existing.image_path || null;
      }

      if (req.file) {
        const newImage = await compressAuctionImage(req.file.buffer);
        if (newImage) {
          if (image_path) fs.promises.unlink(path.join(__dirname, '..', 'uploads', image_path)).catch(() => {});
          image_path = newImage;
        }
      }

      const linkedId = linked_transaction_id ? Number(linked_transaction_id) : null;
      const params = [
        title.trim(),
        (description || '').trim(),
        image_path,
        parseFloat(starting_price),
        parseFloat(min_increment),
        quantity ? parseFloat(quantity) : null,
        (unit || '').trim() || null,
        toSqlDateTime(start_date),
        toSqlDateTime(end_date),
        finalStatus,
        Number.isInteger(linkedId) && linkedId > 0 ? linkedId : null,
      ];

      if (auctionId) {
        jam3yaDb.run(
          `UPDATE auction_items SET title=?, description=?, image_path=?, starting_price=?, min_increment=?, quantity=?, unit=?, start_date=?, end_date=?, status=?, linked_transaction_id=? WHERE id=?`,
          [...params, auctionId],
          (err) => {
            if (err) {
              console.error('Auction update error:', err);
              return res.redirect('/jam3ya/dashboard?tab=auctions&error=save_failed');
            }
            res.redirect('/jam3ya/dashboard?tab=auctions');
          }
        );
      } else {
        jam3yaDb.run(
          `INSERT INTO auction_items (title, description, image_path, starting_price, min_increment, quantity, unit, start_date, end_date, status, linked_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
          (err) => {
            if (err) {
              console.error('Auction insert error:', err);
              return res.redirect('/jam3ya/dashboard?tab=auctions&error=save_failed');
            }
            res.redirect('/jam3ya/dashboard?tab=auctions');
          }
        );
      }
    } catch (err) {
      console.error('Auction Save Error:', err);
      res.redirect('/jam3ya/dashboard?tab=auctions&error=save_failed');
    }
  });

  router.post('/auctions/cancel', requireJam3yaAdmin, checkJam3yaDb, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run(
      "UPDATE auction_items SET status = 'cancelled' WHERE id = ? AND status IN ('draft','published','ended')",
      [id],
      (err) => {
        if (err) console.error('Auction cancel error:', err);
        res.redirect('/jam3ya/dashboard?tab=auctions');
      }
    );
  });

  router.post('/auctions/end-now', requireJam3yaAdmin, checkJam3yaDb, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run(
      "UPDATE auction_items SET status = 'ended' WHERE id = ? AND status = 'published'",
      [id],
      (err) => {
        if (err) console.error('Auction end-now error:', err);
        res.redirect('/jam3ya/dashboard?tab=auctions');
      }
    );
  });

  router.post('/auctions/reopen', requireJam3yaAdmin, checkJam3yaDb, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run(
      "UPDATE auction_items SET status = 'published', winner_member_id = NULL, winning_bid_id = NULL, winner_bid_amount = NULL, awarded_at = NULL WHERE id = ? AND status = 'awarded'",
      [id],
      (err) => {
        if (err) console.error('Auction reopen error:', err);
        res.redirect('/jam3ya/dashboard?tab=auctions');
      }
    );
  });

  router.post('/auctions/delete', requireJam3yaAdmin, checkJam3yaDb, (req, res) => {
    const { id } = req.body;
    jam3yaDb.get('SELECT image_path FROM auction_items WHERE id = ?', [id], (err, row) => {
      if (row && row.image_path) {
        fs.promises.unlink(path.join(__dirname, '..', 'uploads', row.image_path)).catch(() => {});
      }
      jam3yaDb.run('DELETE FROM auction_bids WHERE auction_id = ?', [id], () => {
        jam3yaDb.run('DELETE FROM auction_items WHERE id = ?', [id], (delErr) => {
          if (delErr) console.error('Auction delete error:', delErr);
          res.redirect('/jam3ya/dashboard?tab=auctions');
        });
      });
    });
  });

  router.get('/auctions/:id/bids', requireJam3yaAdmin, checkJam3yaDb, (req, res) => {
    const { id } = req.params;
    jam3yaDb.all(
      `SELECT b.id, b.amount, b.created_at, m.name AS member_name, m.phone AS member_phone, m.member_code
       FROM auction_bids b JOIN members m ON m.id = b.member_id
       WHERE b.auction_id = ? ORDER BY b.amount DESC, b.id ASC`,
      [id],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'خطأ في جلب العروض' });
        res.json({ success: true, bids: rows || [] });
      }
    );
  });

  router.post('/auctions/:id/award', requireJam3yaAdmin, checkJam3yaDb, (req, res) => {
    const { id } = req.params;
    const { winning_bid_id } = req.body;

    jam3yaDb.get(
      `SELECT b.id, b.amount, b.member_id, m.name AS member_name, m.member_code
       FROM auction_bids b JOIN members m ON m.id = b.member_id
       WHERE b.id = ? AND b.auction_id = ?`,
      [winning_bid_id, id],
      (err, bid) => {
        if (err || !bid) return res.status(404).json({ success: false, message: 'العرض غير موجود' });

        jam3yaDb.get('SELECT * FROM auction_items WHERE id = ?', [id], (aErr, auction) => {
          if (aErr || !auction) return res.status(404).json({ success: false, message: 'المزايدة غير موجودة' });
          if (!['published', 'ended'].includes(auction.status)) {
            return res.status(400).json({ success: false, message: 'لا يمكن ترسية هذه المزايدة في حالتها الحالية' });
          }

          jam3yaDb.run(
            `UPDATE auction_items SET status='awarded', winner_member_id=?, winning_bid_id=?, winner_bid_amount=?, awarded_at=? WHERE id=?`,
            [bid.member_id, bid.id, bid.amount, nowSqlDateTime(), id],
            (uErr) => {
              if (uErr) return res.status(500).json({ success: false, message: 'فشل حفظ الترسية' });
              res.json({
                success: true,
                member_id: bid.member_id,
                member_name: bid.member_name,
                member_code: bid.member_code,
                amount: bid.amount,
                auction_title: auction.title,
                auction_description: auction.description,
              });
            }
          );
        });
      }
    );
  });

  // ------------------------------
  // Auctions: public bidding (no jam3ya session required)
  // ------------------------------
  router.get('/auctions/:id/status', checkJam3yaDb, (req, res) => {
    const { id } = req.params;
    jam3yaDb.get('SELECT starting_price, status, start_date, end_date FROM auction_items WHERE id = ?', [id], (err, rawAuction) => {
      if (err || !rawAuction) return res.status(404).json({ success: false });
      const auction = normalizeAuctionDates(rawAuction);
      getAuctionPriceInfo(id, (pErr, priceRow) => {
        if (pErr) return res.status(500).json({ success: false });
        const currentPrice = priceRow && priceRow.top_bid != null ? Number(priceRow.top_bid) : Number(auction.starting_price);
        res.json({
          success: true,
          current_price: currentPrice,
          bid_count: priceRow ? priceRow.bid_count : 0,
          effective_status: computeEffectiveStatus(auction),
        });
      });
    });
  });

  router.post('/auctions/:id/check-passcode', checkJam3yaDb, (req, res) => {
    const { passcode } = req.body;
    findMemberByPasscode(passcode, (err, member) => {
      if (err) return res.status(500).json({ success: false, message: 'حدث خطأ في النظام' });
      if (!member) return res.json({ success: false, message: 'الرمز السري غير صحيح' });
      res.json({ success: true, member_name: member.nickname || member.name });
    });
  });

  router.post('/auctions/:id/bid', checkJam3yaDb, (req, res) => {
    const { id } = req.params;
    const { passcode, amount } = req.body;
    const bidAmount = parseFloat(amount);

    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({ success: false, message: 'قيمة العرض غير صحيحة' });
    }

    findMemberByPasscode(passcode, (mErr, member) => {
      if (mErr) return res.status(500).json({ success: false, message: 'حدث خطأ في النظام' });
      if (!member) return res.status(403).json({ success: false, message: 'الرمز السري غير صحيح' });

      jam3yaDb.get('SELECT * FROM auction_items WHERE id = ?', [id], (aErr, rawAuction) => {
        if (aErr || !rawAuction) return res.status(404).json({ success: false, message: 'المزايدة غير موجودة' });
        const auction = normalizeAuctionDates(rawAuction);

        const now = nowSqlDateTime();
        if (computeEffectiveStatus(auction, now) !== 'active') {
          return res.status(400).json({ success: false, message: 'المزايدة غير متاحة للمزايدة حالياً' });
        }

        getAuctionPriceInfo(id, (pErr, priceRow) => {
          if (pErr) return res.status(500).json({ success: false, message: 'حدث خطأ في النظام' });
          const currentPrice = priceRow && priceRow.top_bid != null ? Number(priceRow.top_bid) : Number(auction.starting_price);
          const minNext = currentPrice + Number(auction.min_increment);

          if (bidAmount < minNext - 0.0001) {
            return res.status(409).json({
              success: false,
              message: `تم تجاوز عرضك من مزايد آخر، السعر الحالي الآن ${currentPrice}`,
              current_price: currentPrice,
            });
          }

          jam3yaDb.run('INSERT INTO auction_bids (auction_id, member_id, amount) VALUES (?, ?, ?)', [id, member.id, bidAmount], (iErr) => {
            if (iErr) return res.status(500).json({ success: false, message: 'فشل تسجيل العرض' });
            res.json({ success: true, current_price: bidAmount });
          });
        });
      });
    });
  });

  // Note: dashboard + باقي العمليات الإدارية موجودة في server.js حالياً.
  // تم نقلها هنا (خيار A) لتصبح كل مسارات الجمعية داخل Router واحد تحت /jam3ya/*.

  // ------------------------------
  // Delete / approve transactions
  // ------------------------------
  router.post('/transactions/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.serialize(() => {
      jam3yaDb.run('DELETE FROM obligation_payments WHERE transaction_id = ?', [id], (payErr) => {
        if (payErr) console.error('Obligation Payment Delete Error:', payErr);
        jam3yaDb.run('DELETE FROM transactions WHERE id = ?', [id], async (err) => {
          if (err) return res.status(500).send('Error deleting transaction');
          await updatePublicExcelFile();
          res.redirect('/jam3ya/dashboard?tab=transactions');
        });
      });
    });
  });

  router.post('/transactions/approve', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('UPDATE transactions SET is_approved = 1 WHERE id = ?', [id], async (err) => {
      if (err) return res.status(500).send('Error approving transaction');
      await updatePublicExcelFile();
      res.redirect('/jam3ya/dashboard?tab=transactions');
    });
  });

  // ------------------------------
  // Dashboard
  // ------------------------------
  router.get('/dashboard', requireJam3yaAdmin, (req, res) => {
    const adminName = req.session.jam3ya_admin_name || 'مدير النظام';

    const dbAll = (sql, params = []) =>
      new Promise((resolve, reject) => {
        jam3yaDb.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });

    jam3yaDb.serialize(async () => {
      try {
        const members = await dbAll('SELECT * FROM members ORDER BY name ASC');

        let subjects = [];
        try {
          subjects = await dbAll('SELECT * FROM subjects ORDER BY name ASC');
        } catch (err) {
          subjects = [];
        }

        let infoMessages = [];
        try {
          infoMessages = await dbAll('SELECT * FROM info_messages ORDER BY created_at DESC');
        } catch {
          infoMessages = [];
        }

        const transactions = await dbAll('SELECT * FROM transactions ORDER BY date ASC, id ASC');

        const recentSubjects = [];
        const seenSubjects = new Set();
        [...transactions]
          .reverse()
          .forEach((t) => {
            const subjectName = String(t.subject || '').trim();
            if (!subjectName) return;
            if (seenSubjects.has(subjectName)) return;
            seenSubjects.add(subjectName);
            recentSubjects.push(subjectName);
          });
        const activeSubjects = recentSubjects.slice(0, 4).map((name) => {
          const subj = subjects.find((s) => s.name === name);
          return { name, type: subj ? (subj.type || 'expense') : 'expense' };
        });

        const mainData = processJam3yaData(transactions, 0);

        let obligationsRows = [];
        try {
          obligationsRows = await dbAll(
            "SELECT o.id, o.subject, o.description, o.total_amount, COALESCE(SUM(p.amount), 0) AS paid_amount FROM obligations o LEFT JOIN obligation_payments p ON p.obligation_id = o.id GROUP BY o.id ORDER BY o.id DESC"
          );
        } catch {
          obligationsRows = [];
        }

        const obligations = (obligationsRows || []).map((o) => {
          const paid = Number(o.paid_amount || 0);
          const total = Number(o.total_amount || 0);
          const remaining = total - paid;
          let status = 'open';
          if (paid <= 0) status = 'open';
          else if (remaining > 0) status = 'partial';
          else status = 'settled';
          return { id: o.id, subject: o.subject, description: o.description, total_amount: total, paid_amount: paid, remaining_amount: remaining, status };
        });

        let visitors = [];
        try {
          visitors = await dbAll('SELECT * FROM visitors ORDER BY id DESC LIMIT 200');
        } catch {
          visitors = [];
        }

        const memberMap = {};
        const memberIdMap = {};
        (members || []).forEach((m) => {
          memberMap[m.member_code] = m.name;
          memberIdMap[m.id] = m.name;
        });

        const processedTransactions = (transactions || [])
          .map((t) => {
            let displayItem = t.item;
            let isMember = false;
            if (memberMap[t.item]) {
              displayItem = memberMap[t.item];
              isMember = true;
            }
            return { ...t, displayItem, isMember };
          })
          .reverse();

        const currentYear = new Date().getFullYear().toString();
        const targetYear = req.query.unpaid_year || currentYear;
        const paidMemberCodes = new Set();

        const paymentReport = {};
        const yearsSet = new Set(['2023', '2024', currentYear, targetYear]);

        (transactions || []).forEach((t) => {
          let dateStr = t.date instanceof Date ? t.date.toISOString().split('T')[0] : String(t.date);
          t.date = dateStr;

          const subject = String(t.subject || '').trim();
          const item = String(t.item || '').trim();
          let details = String(t.details || '');
          details = details.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

          if (subject === 'مساهمات الاعضاء') {
            const yearsInDetails = details.match(/\b20\d{2}\b/g);

            let coveredYears = [];
            if (yearsInDetails && yearsInDetails.length > 0) coveredYears = yearsInDetails;
            else if (dateStr) coveredYears = [dateStr.split('-')[0]];

            if (!paymentReport[item]) paymentReport[item] = {};
            coveredYears.forEach((year) => {
              if (year >= '2023') {
                yearsSet.add(year);
                if (!paymentReport[item][year]) paymentReport[item][year] = 0;
                const amountPerYear = Number(t.amount || 0) / coveredYears.length;
                paymentReport[item][year] += amountPerYear;
              }
            });

            let isPaidForTargetYear = false;
            if (yearsInDetails && yearsInDetails.length > 0) {
              if (yearsInDetails.includes(targetYear)) isPaidForTargetYear = true;
            } else if (dateStr && dateStr.startsWith(targetYear)) {
              isPaidForTargetYear = true;
            }
            if (isPaidForTargetYear) paidMemberCodes.add(item);
          }
        });

        const sortedYears = Array.from(yearsSet).sort();
        const yearlyTotals = {};
        sortedYears.forEach((y) => (yearlyTotals[y] = 0));

        Object.entries(paymentReport).forEach(([, memberPayments]) => {
          for (const [year, amount] of Object.entries(memberPayments)) {
            if (yearlyTotals[year] !== undefined) yearlyTotals[year] += amount;
          }
        });

        const unpaidMembers = (members || []).filter((m) => {
          const memberCode = String(m.member_code || '').trim();
          const isActive = m.is_active == 1 || m.is_active == null;
          if (!isActive) return false;
          if (paidMemberCodes.has(memberCode)) return false;
          return true;
        });

        let auctions = [];
        try {
          await syncEndedAuctions();
          const auctionRows = (await dbAll('SELECT * FROM auction_items ORDER BY created_at DESC')).map(normalizeAuctionDates);
          const now = nowSqlDateTime();
          auctions = await Promise.all(
            auctionRows.map(
              (a) =>
                new Promise((resolve) => {
                  getAuctionPriceInfo(a.id, (err, priceRow) => {
                    const currentPrice =
                      !err && priceRow && priceRow.top_bid != null ? Number(priceRow.top_bid) : Number(a.starting_price);
                    resolve({
                      ...a,
                      current_price: currentPrice,
                      bid_count: !err && priceRow ? priceRow.bid_count : 0,
                      effective_status: computeEffectiveStatus(a, now),
                      start_date_display: formatArabicShortDateTime(a.start_date),
                      end_date_display: formatArabicShortDateTime(a.end_date),
                      winner_name: a.winner_member_id ? (memberIdMap[a.winner_member_id] || null) : null,
                    });
                  });
                })
            )
          );
        } catch (err) {
          console.error('Load auctions for dashboard error:', err);
          auctions = [];
        }

        let recentTransactionsForAuctionLink = [];
        try {
          const linkRows = await dbAll(
            "SELECT id, date, subject, item, details FROM transactions WHERE amount < 0 AND subject NOT LIKE '%فاتور%' AND subject NOT LIKE '%فواتير%' ORDER BY date DESC, id DESC LIMIT 100"
          );
          recentTransactionsForAuctionLink = linkRows.map((t) => {
            const displayItem = memberMap[t.item] || t.item || '';
            const shortDate = formatShortDateDMY(t.date);
            const labelParts = [shortDate, t.subject, displayItem].filter(Boolean);
            if (t.details) labelParts.push(t.details);
            return { id: t.id, label: labelParts.join(' - '), details: t.details || '' };
          });
        } catch (err) {
          recentTransactionsForAuctionLink = [];
        }

        const serverNowForView = nowSqlDateTime().slice(0, 16).replace(' ', 'T');

        res.render('jam3ya-dashboard', {
          members,
          subjects,
          activeSubjects,
          transactions: processedTransactions,
          unpaidMembers,
          targetYear,
          paymentReport,
          yearlyTotals,
          sortedYears,
          obligations,
          mainData,
          adminName,
          visitors,
          infoMessages,
          auctions,
          recentTransactionsForAuctionLink,
          serverNowForView,
          layout: false,
        });
      } catch (err) {
        console.error('Jam3ya Dashboard Error:', err);
        res.status(500).send('Database Error');
      }
    });
  });

  // ------------------------------
  // Export
  // ------------------------------
  router.get('/export/excel', requireJam3yaAdmin, (req, res) => {
    jam3yaDb.serialize(() => {
      jam3yaDb.all('SELECT * FROM transactions ORDER BY date ASC, id ASC', (err, rows) => {
        if (err) return res.status(500).send('DB Error (Transactions): ' + err.message);
        jam3yaDb.all('SELECT member_code, name FROM members', (mErr, members) => {
          if (mErr) return res.status(500).send('DB Error (Members): ' + mErr.message);
          const codeToName = {};
          const nameToCode = {};
          (members || []).forEach((m) => {
            const code = String(m.member_code).trim();
            const name = String(m.name).trim();
            codeToName[code] = name;
            nameToCode[name] = code;
          });
          processJam3yaData(rows || [], 0);
          const modeParam = String(req.query.mode || '').toLowerCase();
          const mode = modeParam === 'names' ? 'names' : 'codes';
          const newestFirst = (rows || [])
            .map((t) => {
              const rawItem = t.item != null ? String(t.item).trim() : '';
              let displayItem = rawItem;
              if (mode === 'names' && codeToName[rawItem]) displayItem = codeToName[rawItem];
              else if (mode === 'codes' && nameToCode[rawItem]) displayItem = nameToCode[rawItem];
              return { date: t.date, subject: t.subject, item: displayItem, details: t.details || '', amount: t.amount, balance: t.balance };
            })
            .reverse();
          const data = [['التسلسل', 'التاريخ', 'الموضوع', 'البند', 'التفاصيل', 'القيمة', 'المجموع التراكمي']];
          newestFirst.forEach((t, idx) => {
            data.push([
              idx + 1,
              t.date,
              t.subject,
              t.item,
              t.details,
              typeof t.amount === 'number' ? Number(t.amount.toFixed(3)) : t.amount,
              typeof t.balance === 'string' ? Number(parseFloat(t.balance).toFixed(3)) : t.balance,
            ]);
          });
          const wb = XLSX.utils.book_new();
          const ws = XLSX.utils.aoa_to_sheet(data);
          XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
          const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="jam3ya-transactions.xlsx"');
          res.send(buf);
        });
      });
    });
  });

  router.get('/export/pdf', requireJam3yaAdmin, (req, res) => {
    jam3yaDb.serialize(() => {
      jam3yaDb.all('SELECT * FROM transactions ORDER BY date ASC, id ASC', (err, rows) => {
        if (err) return res.status(500).send('DB Error (Transactions): ' + err.message);
        jam3yaDb.all('SELECT member_code, name FROM members', (mErr, members) => {
          if (mErr) return res.status(500).send('DB Error (Members): ' + mErr.message);
          const codeToName = {};
          const nameToCode = {};
          (members || []).forEach((m) => {
            const code = String(m.member_code).trim();
            const name = String(m.name).trim();
            codeToName[code] = name;
            nameToCode[name] = code;
          });
          processJam3yaData(rows || [], 0);
          const modeParam = String(req.query.mode || '').toLowerCase();
          const mode = modeParam === 'names' ? 'names' : 'codes';
          const newestFirst = (rows || [])
            .map((t) => {
              const rawItem = t.item != null ? String(t.item).trim() : '';
              let displayItem = rawItem;
              if (mode === 'names' && codeToName[rawItem]) displayItem = codeToName[rawItem];
              else if (mode === 'codes' && nameToCode[rawItem]) displayItem = nameToCode[rawItem];
              return { date: t.date, subject: t.subject, item: displayItem, details: t.details || '', amount: t.amount, balance: t.balance };
            })
            .reverse();

          const rowsHtml = newestFirst
            .map(
              (t, idx) => `
                <tr>
                  <td style="text-align:center;">${idx + 1}</td>
                  <td>${t.date || '-'}</td>
                  <td>${t.subject || '-'}</td>
                  <td>${t.item || '-'}</td>
                  <td>${t.details || '-'}</td>
                  <td dir="ltr" style="text-align:right;">${(typeof t.amount === 'number' ? t.amount.toFixed(3) : t.amount) || '0.000'}</td>
                  <td dir="ltr" style="text-align:right;">${(typeof t.balance === 'string' ? parseFloat(t.balance).toFixed(3) : (t.balance || 0)).toString()}</td>
                </tr>
              `
            )
            .join('');

          const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تصدير PDF - جمعية الخطوة الأهلية</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 30px; color: #333; }
    h2 { margin-top: 0; color: #2c3e50; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #ddd; padding: 8px; white-space: normal; word-break: break-word; overflow-wrap: break-word; }
    th { background: #f2f6fa; color: #2c3e50; }
    .meta { margin-bottom: 10px; color: #666; font-size: 0.95rem; }
    @media print { .no-print { display: none; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 10px;">
    <button onclick="window.print()" style="padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#f7f7f7;cursor:pointer;">طباعة / حفظ PDF</button>
  </div>
  <h2>تقرير العمليات المالية</h2>
  <div class="meta">مرتب بالتاريخ من الأحدث للأقدم</div>
  <table>
    <colgroup>
      <col style="width:6%;">
      <col style="width:10%;">
      <col style="width:15%;">
      <col style="width:20%;">
      <col style="width:29%;">
      <col style="width:10%;">
      <col style="width:10%;">
    </colgroup>
    <thead>
      <tr>
        <th>التسلسل</th>
        <th>التاريخ</th>
        <th>الموضوع</th>
        <th>البند</th>
        <th>التفاصيل</th>
        <th>القيمة</th>
        <th>المجموع التراكمي</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

          res.send(html);
        });
      });
    });
  });

  // ------------------------------
  // Info messages
  // ------------------------------
  router.post('/info-messages/save', requireJam3yaAdmin, (req, res) => {
    const { id, message, display_until } = req.body;
    if (id) {
      jam3yaDb.run('UPDATE info_messages SET message = ?, display_until = ? WHERE id = ?', [message, display_until, id], () => {
        res.redirect('/jam3ya/dashboard?tab=info-messages');
      });
    } else {
      jam3yaDb.run('INSERT INTO info_messages (message, display_until) VALUES (?, ?)', [message, display_until], () => {
        res.redirect('/jam3ya/dashboard?tab=info-messages');
      });
    }
  });

  router.post('/info-messages/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('DELETE FROM info_messages WHERE id = ?', [id], () => {
      res.redirect('/jam3ya/dashboard?tab=info-messages');
    });
  });

  // ------------------------------
  // Members
  // ------------------------------
  router.post('/members/save', requireJam3yaAdmin, (req, res) => {
    const { id, member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin } = req.body;
    const isActiveVal = is_active ? 1 : 0;
    const isAdminVal = is_admin ? 1 : 0;

    if (id) {
      let sql = 'UPDATE members SET member_code = ?, name = ?, nickname = ?, phone = ?, email = ?, is_active = ?, notes = ?, is_admin = ?';
      const params = [member_code, name, nickname, phone, email, isActiveVal, notes, isAdminVal];
      if (passcode && String(passcode).trim() !== '') {
        sql += ', passcode = ?';
        params.push(passcode);
      }
      sql += ' WHERE id = ?';
      params.push(id);
      jam3yaDb.run(sql, params, () => res.redirect('/jam3ya/dashboard?tab=members'));
    } else {
      let finalPasscode = passcode;
      if (!finalPasscode) {
        const chars = 'abcdefghijklmnopqrstuvwxyz';
        let suffix = '';
        for (let i = 0; i < 2; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
        finalPasscode = (phone || '') + suffix;
      }

      if (member_code && String(member_code).trim() !== '') {
        jam3yaDb.run(
          'INSERT INTO members (member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [member_code, name, nickname, phone, email, finalPasscode, isActiveVal, notes, isAdminVal],
          () => res.redirect('/jam3ya/dashboard?tab=members')
        );
      } else {
        jam3yaDb.get('SELECT MAX(CAST(member_code AS INTEGER)) as maxCode FROM members', (err, row) => {
          if (err) return res.status(500).send('DB Error');
          const nextCode = row && row.maxCode ? row.maxCode + 1 : 1200;
          jam3yaDb.run(
            'INSERT INTO members (member_code, name, nickname, phone, email, passcode, is_active, notes, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [String(nextCode), name, nickname, phone, email, finalPasscode, isActiveVal, notes, isAdminVal],
            () => res.redirect('/jam3ya/dashboard?tab=members')
          );
        });
      }
    }
  });

  router.post('/members/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('DELETE FROM members WHERE id = ?', [id], () => res.redirect('/jam3ya/dashboard?tab=members'));
  });

  // ------------------------------
  // Subjects
  // ------------------------------
  router.post('/subjects/add', requireJam3yaAdmin, (req, res) => {
    const { name, type } = req.body;
    const subjectType = type === 'income' ? 'income' : 'expense';
    jam3yaDb.run('INSERT INTO subjects (name, type) VALUES (?, ?)', [name, subjectType], () => res.redirect('/jam3ya/dashboard?tab=subjects'));
  });

  router.post('/subjects/edit', requireJam3yaAdmin, (req, res) => {
    const { id, name, old_name, type } = req.body;
    const subjectType = type === 'income' ? 'income' : 'expense';
    jam3yaDb.run('UPDATE subjects SET name = ?, type = ? WHERE id = ?', [name, subjectType, id], (err) => {
      if (err) return res.status(500).send('Error updating subject');
      if (old_name && old_name !== name) {
        jam3yaDb.run('UPDATE transactions SET subject = ? WHERE subject = ?', [name, old_name], () => {
          res.redirect('/jam3ya/dashboard?tab=subjects');
        });
      } else {
        res.redirect('/jam3ya/dashboard?tab=subjects');
      }
    });
  });

  router.post('/subjects/delete', requireJam3yaAdmin, (req, res) => {
    const { id } = req.body;
    jam3yaDb.run('DELETE FROM subjects WHERE id = ?', [id], () => res.redirect('/jam3ya/dashboard?tab=subjects'));
  });

  // ------------------------------
  // Obligations
  // ------------------------------
  router.post('/obligations/add', requireJam3yaAdmin, (req, res) => {
    const { subject, description, notes, total_amount } = req.body;
    const amount = parseFloat(total_amount);
    if (!subject || isNaN(amount) || amount <= 0) return res.status(400).send('Invalid obligation data');

    let finalDescription = description || '';
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : '';
    if (trimmedNotes) finalDescription += (finalDescription ? '\n' : '') + 'ملاحظات: ' + trimmedNotes;

    jam3yaDb.run('INSERT INTO obligations (subject, description, total_amount) VALUES (?, ?, ?)', [String(subject).trim(), finalDescription || null, amount], (err) => {
      if (err) return res.status(500).send('Error adding obligation');
      res.redirect('/jam3ya/dashboard');
    });
  });

  router.post('/obligations/edit', requireJam3yaAdmin, (req, res) => {
    const { id, subject, description, notes, total_amount } = req.body;
    const amount = parseFloat(total_amount);
    if (!id || !subject || isNaN(amount) || amount <= 0) return res.status(400).send('Invalid obligation data');

    let finalDescription = description || '';
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : '';
    if (trimmedNotes) finalDescription += (finalDescription ? '\n' : '') + 'ملاحظات: ' + trimmedNotes;

    jam3yaDb.run('UPDATE obligations SET subject = ?, description = ?, total_amount = ? WHERE id = ?', [String(subject).trim(), finalDescription || null, amount, id], (err) => {
      if (err) return res.status(500).send('Error updating obligation');
      res.redirect('/jam3ya/dashboard');
    });
  });

  // Reminders: still handled by legacy code in server.js for now.

  return router;
}

module.exports = { buildJam3yaRouter };
