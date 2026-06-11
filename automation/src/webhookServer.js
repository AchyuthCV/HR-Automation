// Express webhook server — receives push notifications from:
//   POST /drive-push   ← Google Drive file change notifications
//   POST /gmail-push   ← Gmail inbox change notifications (via Pub/Sub)
//   POST /employee     ← HR adds a new employee (triggers onboarding)
//   GET  /health       ← uptime check

const express = require('express');
const fs = require('fs');
const path = require('path');
const { getChangedFiles, loadPushChannels } = require('./driveWatcher');
const { processGmailPush } = require('./gmailWatcher');
require('dotenv').config();

const SEEN_FILES_PATH = path.join(__dirname, '..', 'seen-files.json');

// employeeRegistry and handleNewFile are injected by index.js after boot
let _auth = null;
let _employeeRegistry = {};     // { [employeeId]: employee }
let _handleNewFile = null;      // async (auth, employee, file) => void
let _handleReply = null;        // async (classified, rawMessage) => void
let _onNewEmployee = null;      // async (employeeData) => void

function init({ auth, employeeRegistry, handleNewFile, handleReply, onNewEmployee }) {
  _auth = auth;
  _employeeRegistry = employeeRegistry;
  _handleNewFile = handleNewFile;
  _handleReply = handleReply;
  _onNewEmployee = onNewEmployee;
}

// Track last-seen file IDs per employee folder — persisted to seen-files.json
// so restarting the engine doesn't re-process already-handled files.
function loadSeenFiles() {
  if (fs.existsSync(SEEN_FILES_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SEEN_FILES_PATH, 'utf8'));
      // Convert plain arrays back to Sets
      const result = {};
      for (const [empId, ids] of Object.entries(raw)) {
        result[empId] = new Set(ids);
      }
      return result;
    } catch (e) {
      console.warn('[Webhook] Could not load seen-files.json:', e.message);
    }
  }
  return {};
}

function saveSeenFiles(seenFileIds) {
  try {
    const serialisable = {};
    for (const [empId, set] of Object.entries(seenFileIds)) {
      serialisable[empId] = [...set];
    }
    fs.writeFileSync(SEEN_FILES_PATH, JSON.stringify(serialisable, null, 2));
  } catch (e) {
    console.warn('[Webhook] Could not save seen-files.json:', e.message);
  }
}

const seenFileIds = loadSeenFiles();

const app = express();
app.use(express.json());
// Gmail Pub/Sub sends raw body — parse it too
app.use(express.raw({ type: 'application/json' }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const employees = Object.values(_employeeRegistry).map(emp => {
    // Count done tasks
    let totalTasks = 0, doneTasks = 0;
    for (const phase of Object.values(emp.checklist || {})) {
      if (phase.tasks) {
        for (const task of Object.values(phase.tasks)) {
          totalTasks++;
          if (task.done) doneTasks++;
        }
      }
    }
    // Find current phase (first phase with incomplete tasks)
    let currentPhase = 'Complete';
    for (const [key, phase] of Object.entries(emp.checklist || {})) {
      if (phase.tasks && Object.values(phase.tasks).some(t => !t.done)) {
        currentPhase = phase.label;
        break;
      }
    }
    return {
      employeeId: emp.employeeId,
      name: emp.name,
      doj: emp.doj,
      currentPhase,
      progress: `${doneTasks}/${totalTasks} tasks`,
      milestonesScheduled: emp.milestonesScheduled || false,
      activeTimers: Object.keys(emp.replyTimers || {}).length + Object.keys(emp.noResponseTimers || {}).length,
    };
  });

  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()) + 's',
    employees,
  });
});

// ─── Employees list ─────────────────────────────────────────────────────────────
app.get('/employees', (_req, res) => {
  const list = Object.values(_employeeRegistry).map(emp => ({
    employeeId: emp.employeeId,
    name: emp.name,
    personalEmail: emp.personalEmail,
    officialEmail: emp.officialEmail || null,
    doj: emp.doj,
    driveFolderId: emp.driveFolderId,
    milestonesScheduled: emp.milestonesScheduled || false,
    checklist: emp.checklist,
  }));
  res.json({ count: list.length, employees: list });
});

// ─── Drive push handler ────────────────────────────────────────────────────────
// Google sends a POST with headers X-Goog-Channel-Token (= employeeId) and
// X-Goog-Resource-State ('sync' on register, 'update'/'add' on change).
app.post('/drive-push', async (req, res) => {
  // Always respond 200 immediately — Google retries on non-2xx
  res.sendStatus(200);

  const state = req.headers['x-goog-resource-state'];
  const employeeId = req.headers['x-goog-channel-token'];

  // 'sync' is the handshake ping — nothing to do
  if (state === 'sync') {
    console.log(`[Webhook] Drive sync handshake for ${employeeId}`);
    return;
  }

  if (!employeeId || !_employeeRegistry[employeeId]) {
    console.warn(`[Webhook] Drive push for unknown employee: ${employeeId}`);
    return;
  }

  const employee = _employeeRegistry[employeeId];
  if (!seenFileIds[employeeId]) seenFileIds[employeeId] = new Set();

  try {
    // Fetch files modified in the last 5 minutes (push doesn't tell us which file)
    const sinceMs = Date.now() - 5 * 60 * 1000;
    const files = await getChangedFiles(_auth, employee.driveFolderId, sinceMs);

    for (const file of files) {
      if (!seenFileIds[employeeId].has(file.id)) {
        seenFileIds[employeeId].add(file.id);
        saveSeenFiles(seenFileIds);
        console.log(`[Webhook] Drive push → new file: ${file.name} for ${employee.name}`);
        await _handleNewFile(_auth, employee, file).catch(err =>
          console.error(`[Webhook] handleNewFile error:`, err.message)
        );
      }
    }
  } catch (err) {
    console.error('[Webhook] Drive push processing error:', err.message);
  }
});

// ─── Gmail push handler ────────────────────────────────────────────────────────
// Pub/Sub posts a JSON envelope: { message: { data: <base64>, messageId, ... }, subscription }
app.post('/gmail-push', async (req, res) => {
  res.sendStatus(200);

  let body = req.body;
  // express.raw gives a Buffer if content-type is application/json
  if (Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString()); } catch { return; }
  }

  if (!body || !body.message) {
    console.warn('[Webhook] Gmail push missing message body');
    return;
  }

  try {
    await processGmailPush(_auth, body, async (classified, rawMsg) => {
      if (_handleReply) await _handleReply(classified, rawMsg);
    });
  } catch (err) {
    console.error('[Webhook] Gmail push processing error:', err.message);
  }
});

// ─── Add new employee endpoint ─────────────────────────────────────────────────
// HR (or a Google Sheet trigger) POSTs employee details here to start onboarding.
// Body: { employeeId, name, personalEmail, doj, driveFolderId,
//         contacts: { recruiterEmail, managerEmail, itEmail } }
app.post('/employee', async (req, res) => {
  const required = ['employeeId', 'name', 'personalEmail', 'doj', 'driveFolderId'];
  const missing = required.filter(f => !req.body[f]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  const { employeeId } = req.body;
  if (_employeeRegistry[employeeId]) {
    return res.status(409).json({ error: `Employee ${employeeId} already registered` });
  }

  try {
    if (_onNewEmployee) await _onNewEmployee(req.body);
    res.status(201).json({ message: `Onboarding started for ${req.body.name}` });
  } catch (err) {
    console.error('[Webhook] /employee error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Employee status page ──────────────────────────────────────────────────────
app.get('/status/:employeeId', (req, res) => {
  const { readLog } = require('./activityLog');
  const emp = _employeeRegistry[req.params.employeeId];
  if (!emp) return res.status(404).send('<h2>Employee not found</h2>');

  // Count tasks
  let total = 0, done = 0;
  const phases = [];
  for (const [key, phase] of Object.entries(emp.checklist || {})) {
    const tasks = Object.values(phase.tasks || {});
    const phaseDone = tasks.filter(t => t.done).length;
    total += tasks.length;
    done += phaseDone;
    phases.push({ label: phase.label, tasks, phaseDone, phaseTotal: tasks.length });
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Activity log (last 20 events)
  const events = readLog(emp.employeeId).slice(-20).reverse();

  const phaseRows = phases.map(p => {
    const taskRows = p.tasks.map(t =>
      `<tr><td style="padding:4px 12px;">${t.done ? '✅' : '⬜'}</td><td style="padding:4px 8px;color:${t.done ? '#2e7d32' : '#555'}">${t.label}</td></tr>`
    ).join('');
    return `
      <details style="margin-bottom:12px;">
        <summary style="cursor:pointer;font-weight:600;padding:8px;background:#f5f5f5;border-radius:4px;">
          ${p.label} &nbsp;<span style="color:#888;font-weight:400;">(${p.phaseDone}/${p.phaseTotal})</span>
        </summary>
        <table style="width:100%;border-collapse:collapse;margin-top:4px;">${taskRows}</table>
      </details>`;
  }).join('');

  const eventRows = events.length
    ? events.map(e => `<tr><td style="padding:4px 8px;color:#888;white-space:nowrap;">${e.ts.replace('T', ' ').replace('Z', '')}</td><td style="padding:4px 12px;font-family:monospace;">${e.event}</td><td style="padding:4px 8px;color:#555;">${e.detail || ''}</td></tr>`).join('')
    : '<tr><td colspan="3" style="padding:8px;color:#888;">No activity logged yet</td></tr>';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Onboarding Status — ${emp.name}</title>
  <style>
    body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;}
    h1{margin-bottom:4px;}
    .meta{color:#666;margin-bottom:24px;font-size:14px;}
    .progress-bar{background:#e0e0e0;border-radius:8px;height:20px;margin-bottom:24px;}
    .progress-fill{background:#2e7d32;border-radius:8px;height:100%;transition:width .3s;}
    .pct{font-size:13px;color:#555;margin-top:4px;}
    table{width:100%;}
    h2{margin-top:32px;font-size:18px;border-bottom:1px solid #eee;padding-bottom:6px;}
  </style>
</head>
<body>
  <h1>${emp.name}</h1>
  <div class="meta">ID: ${emp.employeeId} &nbsp;|&nbsp; DOJ: ${emp.doj} &nbsp;|&nbsp; ${emp.officialEmail || emp.personalEmail}</div>
  <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
  <div class="pct">${pct}% complete &mdash; ${done} of ${total} tasks done</div>
  <h2>Checklist</h2>
  ${phaseRows}
  <h2>Activity Log</h2>
  <table style="border-collapse:collapse;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">Time (UTC)</th><th style="padding:6px 12px;text-align:left;">Event</th><th style="padding:6px 8px;text-align:left;">Detail</th></tr></thead>
    <tbody>${eventRows}</tbody>
  </table>
</body>
</html>`);
});

// ─── Start the server ──────────────────────────────────────────────────────────
function start(port) {
  const p = port || process.env.WEBHOOK_PORT || 3000;
  app.listen(p, () => {
    console.log(`[Webhook] Server listening on port ${p}`);
    console.log(`[Webhook] Drive push endpoint: ${process.env.WEBHOOK_BASE_URL || 'http://localhost:' + p}/drive-push`);
    console.log(`[Webhook] Gmail push endpoint: ${process.env.WEBHOOK_BASE_URL || 'http://localhost:' + p}/gmail-push`);
  });
  return app;
}

module.exports = { init, start };
