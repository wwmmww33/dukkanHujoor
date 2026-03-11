const nodemailer = require('nodemailer');

function createJam3yaReminders({ jam3yaDb, env }) {
  // Match existing behavior in server.js
  const transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: true,
    auth: {
      user: env.MAIL_USER,
      pass: env.MAIL_PASS,
    },
  });

  async function getUnpaidMembersEmailsForYear(year) {
    return new Promise((resolve, reject) => {
      if (!jam3yaDb) return reject(new Error('Jam3ya DB unavailable'));
      jam3yaDb.serialize(() => {
        jam3yaDb.all('SELECT id, member_code, name, email, is_active, passcode FROM members', (mErr, members) => {
          if (mErr) return reject(mErr);
          const activeWithEmail = (members || []).filter(
            (m) => (m.is_active == 1 || m.is_active == null) && m.email && String(m.email).trim() !== ''
          );

          jam3yaDb.all(
            "SELECT item, date, details, subject, is_approved FROM transactions WHERE subject = 'مساهمات الاعضاء' AND is_approved = 1",
            (tErr, rows) => {
              if (tErr) return reject(tErr);
              const paid = new Set();
              (rows || []).forEach((r) => {
                const item = String(r.item || '').trim();
                const details = String(r.details || '');
                const dateStr = String(r.date || '');
                let isPaid = false;
                const years = details.match(/\d{4}/g) || [];
                if (years.includes(String(year))) isPaid = true;
                else if (dateStr.startsWith(String(year))) isPaid = true;
                if (isPaid) paid.add(item);
              });
              const unpaid = activeWithEmail.filter((m) => !paid.has(String(m.member_code || '').trim()));
              resolve(unpaid);
            }
          );
        });
      });
    });
  }

  async function sendQuarterReminders() {
    try {
      const currentYear = new Date().getFullYear();
      const list = await getUnpaidMembersEmailsForYear(currentYear);
      for (const m of list) {
        const to = String(m.email).trim();
        if (!to) continue;
        await transporter.sendMail({
          from: `"جمعية الخطوة الأهلية" <${env.MAIL_USER}>`,
          to,
          subject: 'جمعية الخطوة الأهلية (تذكير)',
          html: `
            <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; line-height: 1.7; color: #333;">
              <h2 style="color: #2c3e50;">جمعية الخطوة الأهلية</h2>
              <hr style="border: 1px solid #eee;">
              <p>مرحباً ${m.name}،</p>
              <p>هذا تذكير ودي بالمساهمة السنوية عن سنة <strong>${currentYear}</strong>، حيث يظهر لدينا أنك لم تسدد حتى الآن.</p>
              <p>نرجو المبادرة بالسداد جزاكم الله خيراً.</p>
              <br>
              <p>
                لمزيد من التفاصيل، يمكنكم زيارة صفحة الجمعية:<br>
                <a href="${env.BASE_URL || 'http://localhost:3000'}/jam3ya" style="display: inline-block; background-color: #27ae60; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">
                  الذهاب لصفحة الجمعية
                </a>
              </p>
              <p style="background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px dashed #ccc; display: inline-block;">
                <strong>الرمز السري الخاص بك:</strong>
                <span style="font-family: monospace; font-size: 1.2em; color: #c0392b;">${m.passcode || '---'}</span>
              </p>
              <br>
              <p style="color: #777; font-size: 0.9em;">مع التحيات،<br>إدارة جمعية الخطوة الأهلية</p>
            </div>
          `,
        });
      }
    } catch (e) {
      console.error('Quarter reminder error:', e);
    }
  }

  function getNextReminderDate() {
    const now = new Date();
    const months = [2, 5, 8, 11];
    for (let i = 0; i < months.length; i++) {
      const d = new Date(now.getFullYear(), months[i], 23, 19, 0, 0, 0);
      if (d.getTime() > now.getTime()) return d;
    }
    return new Date(now.getFullYear() + 1, months[0], 23, 19, 0, 0, 0);
  }

  function scheduleNextReminder() {
    const next = getNextReminderDate();
    const now = Date.now();
    const delay = Math.max(0, next.getTime() - now);
    const MAX_DELAY = 2147483647;

    if (delay > MAX_DELAY) {
      setTimeout(scheduleNextReminder, MAX_DELAY);
    } else {
      setTimeout(async () => {
        await sendQuarterReminders();
        scheduleNextReminder();
      }, delay);
    }
  }

  return { sendQuarterReminders, scheduleNextReminder };
}

module.exports = { createJam3yaReminders };
