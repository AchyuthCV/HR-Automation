// activityLog.js — append-only per-employee event log
// Each event is one JSON line in logs/<employeeId>.log
// Format: { ts, employeeId, event, detail }

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function log(employee, event, detail = '') {
  try {
    ensureLogsDir();
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      employeeId: employee.employeeId,
      name: employee.name,
      event,
      detail,
    });
    const logPath = path.join(LOGS_DIR, `${employee.employeeId}.log`);
    fs.appendFileSync(logPath, entry + '\n');
  } catch (err) {
    // Never crash the engine due to logging failure
    console.warn(`[Log] Failed to write activity log for ${employee.employeeId}:`, err.message);
  }
}

function readLog(employeeId) {
  const logPath = path.join(LOGS_DIR, `${employeeId}.log`);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

module.exports = { log, readLog };
