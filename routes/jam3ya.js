const XLSX = require('xlsx');
const path = require('path');
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
  router.get('/login', (req, res) => res.render('jam3ya-login', { error: null, layout: false, isAdmin: false }));

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
    const { date, type, subject, member_id, description, details, amount } = req.body;
    const targetDate = date || getGulfDateString();
    let finalAmount = parseFloat(amount);
    if (type === 'expense') finalAmount = -Math.abs(finalAmount);
    else finalAmount = Math.abs(finalAmount);

    const processTransaction = (itemValue) => {
      jam3yaDb.run(
        'INSERT INTO transactions (date, subject, item, details, amount, balance, is_approved, created_by_member) VALUES (?, ?, ?, ?, ?, 0, 1, 0)',
        [targetDate, subject, itemValue, details, finalAmount],
        async function (err) {
          if (err) return res.status(500).send('Error adding transaction');
          await updatePublicExcelFile();
          res.redirect('/jam3ya/dashboard?tab=transactions');
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
        const activeSubjects = recentSubjects.slice(0, 4);

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
        (members || []).forEach((m) => {
          memberMap[m.member_code] = m.name;
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
    const { name } = req.body;
    jam3yaDb.run('INSERT INTO subjects (name) VALUES (?)', [name], (err) => {
      if (err) console.error(err);
      res.redirect('/jam3ya/dashboard?tab=subjects');
    });
  });

  router.post('/subjects/edit', requireJam3yaAdmin, (req, res) => {
    const { id, name, old_name } = req.body;
    jam3yaDb.run('UPDATE subjects SET name = ? WHERE id = ?', [name, id], (err) => {
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
        const activeSubjects = recentSubjects.slice(0, 4);

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
        (members || []).forEach((m) => {
          memberMap[m.member_code] = m.name;
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
    const { name } = req.body;
    jam3yaDb.run('INSERT INTO subjects (name) VALUES (?)', [name], () => res.redirect('/jam3ya/dashboard?tab=subjects'));
  });

  router.post('/subjects/edit', requireJam3yaAdmin, (req, res) => {
    const { id, name, old_name } = req.body;
    jam3yaDb.run('UPDATE subjects SET name = ? WHERE id = ?', [name, id], (err) => {
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
