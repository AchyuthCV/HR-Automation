// activityLog.js — append-only per-employee event log
// Each event is one JSON line in logs/<employeeId>.log
// Format: { ts, employeeId, event, detail }
// Also mirrors every write to the tamper-evident secure audit log.

const fs = require('fs');
const path = require('path');
const { writeAudit } = require('./secureAuditLog');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Validate that a resolved path stays inside the intended directory
function safeLogPath(employeeId) {
  // Reject any id that isn't plain alphanumeric + hyphens/underscores
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(employeeId)) return null;
  const resolved = path.resolve(LOGS_DIR, `${employeeId}.log`);
  // Ensure the resolved path is still inside LOGS_DIR
  if (!resolved.startsWith(path.resolve(LOGS_DIR) + path.sep)) return null;
  return resolved;
}

function log(employee, event, detail = '') {
  try {
    ensureLogsDir();
    const logPath = safeLogPath(employee.employeeId);
    if (!logPath) {
      console.warn(`[Log] Rejected unsafe employeeId in log():`, employee.employeeId);
      return;
    }
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      employeeId: employee.employeeId,
      name: employee.name,
      event: String(event).slice(0, 200),
      detail: String(detail).slice(0, 500),
    });
    fs.appendFileSync(logPath, entry + '\n');
    // Mirror to tamper-evident audit log (HMAC-signed when AUDIT_HMAC_KEY is set)
    writeAudit(employee.employeeId, String(event).slice(0, 200), String(detail).slice(0, 500));
  } catch (err) {
    // Never crash the engine due to logging failure
    console.warn(`[Log] Failed to write activity log for ${employee.employeeId}:`, err.message);
  }
}

function readLog(employeeId) {
  const logPath = safeLogPath(employeeId);
  if (!logPath || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

module.exports = { log, readLog };
