// secureAuditLog.js — append-only audit log with HMAC-SHA256 per-entry integrity
// Each line is: JSON({ ts, employeeId, event, detail, hmac })
// The HMAC signs (ts + employeeId + event + detail) using AUDIT_HMAC_KEY.
// If AUDIT_HMAC_KEY is not set, writes plain entries (no HMAC) — compatible.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.join(__dirname, '..', 'logs', 'audit');

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

function todayFilename() {
  return path.join(AUDIT_DIR, `audit-${new Date().toISOString().slice(0, 10)}.log`);
}

function computeHmac(ts, employeeId, event, detail) {
  const key = process.env.AUDIT_HMAC_KEY;
  if (!key) return null;
  const payload = `${ts}|${employeeId}|${event}|${detail}`;
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function writeAudit(employeeId, event, detail = '') {
  try {
    ensureAuditDir();
    const ts = new Date().toISOString();
    const safeEvent = String(event).slice(0, 200);
    const safeDetail = String(detail).slice(0, 500);
    const hmac = computeHmac(ts, employeeId, safeEvent, safeDetail);
    const entry = JSON.stringify({ ts, employeeId, event: safeEvent, detail: safeDetail, ...(hmac ? { hmac } : {}) });
    fs.appendFileSync(todayFilename(), entry + '\n');
  } catch (err) {
    console.warn('[AuditLog] Write failed:', err.message);
  }
}

// Verify all entries in today's audit log — returns { ok, total, tampered }
function verifyTodayLog() {
  const key = process.env.AUDIT_HMAC_KEY;
  if (!key) return { ok: true, total: 0, tampered: 0, skipped: 'AUDIT_HMAC_KEY not set' };

  const file = todayFilename();
  if (!fs.existsSync(file)) return { ok: true, total: 0, tampered: 0 };

  let total = 0, tampered = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry.hmac) continue; // legacy entry without HMAC — skip
      total++;
      const expected = computeHmac(entry.ts, entry.employeeId, entry.event, entry.detail);
      if (!crypto.timingSafeEqual(Buffer.from(entry.hmac), Buffer.from(expected))) {
        console.error(`[AuditLog] TAMPERED ENTRY DETECTED: ${entry.ts} ${entry.employeeId} ${entry.event}`);
        tampered++;
      }
    } catch { /* skip malformed lines */ }
  }
  return { ok: tampered === 0, total, tampered };
}

module.exports = { writeAudit, verifyTodayLog };
