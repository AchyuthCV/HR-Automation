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

// Prune seen file IDs that were first observed more than 30 days ago.
// Since we only store IDs (not timestamps), we keep a parallel age map in
// seen-files-meta.json: { [empId]: { [fileId]: isoTimestamp } }
const SEEN_META_PATH = path.join(__dirname, '..', 'seen-files-meta.json');
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadSeenMeta() {
  if (fs.existsSync(SEEN_META_PATH)) {
    try { return JSON.parse(fs.readFileSync(SEEN_META_PATH, 'utf8')); } catch { /* ignore */ }
  }
  return {};
}

function pruneSeenFiles(seenFileIds) {
  const meta = loadSeenMeta();
  const now = Date.now();
  let pruned = 0;

  for (const [empId, set] of Object.entries(seenFileIds)) {
    if (!meta[empId]) meta[empId] = {};
    // Stamp any new IDs
    for (const id of set) {
      if (!meta[empId][id]) meta[empId][id] = new Date().toISOString();
    }
    // Remove IDs older than TTL
    for (const [id, ts] of Object.entries(meta[empId])) {
      if (now - new Date(ts).getTime() > TTL_MS) {
        set.delete(id);
        delete meta[empId][id];
        pruned++;
      }
    }
  }

  if (pruned > 0) {
    console.log(`[Webhook] Pruned ${pruned} expired file ID(s) from seen-files cache`);
    saveSeenFiles(seenFileIds);
  }

  try {
    fs.writeFileSync(SEEN_META_PATH, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.warn('[Webhook] Could not save seen-files-meta.json:', e.message);
  }
}

const seenFileIds = loadSeenFiles();
// Prune on load, then every 24 hours
pruneSeenFiles(seenFileIds);
setInterval(() => pruneSeenFiles(seenFileIds), 24 * 60 * 60 * 1000);

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

  const config = require('./config');
  const now = Date.now();
  const STUCK_MS = config.stuckTaskThresholdHours * 60 * 60 * 1000;

  // Build task-level metadata: stuckAt timestamps from activity log
  // Map event "task_started:<taskId>" → timestamp
  const stuckMap = {};
  const allEvents = readLog(emp.employeeId);
  for (const ev of allEvents) {
    if (ev.event && ev.event.startsWith('task_started:')) {
      const tid = ev.event.split(':')[1];
      stuckMap[tid] = new Date(ev.ts).getTime();
    }
  }

  // Check if t16 (official email created) is done
  let t16Done = false;
  for (const phase of Object.values(emp.checklist || {})) {
    if (phase.tasks && phase.tasks['t16'] && phase.tasks['t16'].done) { t16Done = true; break; }
  }

  const verResults = emp.verificationResults || {};

  // Count tasks
  let total = 0, done = 0;
  const phases = [];
  for (const [key, phase] of Object.entries(emp.checklist || {})) {
    const taskEntries = Object.entries(phase.tasks || {});
    const tasks = taskEntries.map(([tid, t]) => ({ ...t, _id: tid }));
    const phaseDone = tasks.filter(t => t.done).length;
    total += tasks.length;
    done += phaseDone;
    phases.push({ label: phase.label, tasks, phaseDone, phaseTotal: tasks.length });
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Activity log (last 20 events)
  const events = allEvents.slice(-20).reverse();

  const markTaskEnabled = !!process.env.MARK_TASK_SECRET;

  const phaseRows = phases.map(p => {
    const taskRows = p.tasks.map(t => {
      const isStuck = !t.done && stuckMap[t._id] && (now - stuckMap[t._id]) > STUCK_MS;
      const stuckBadge = isStuck ? ' <span style="background:#fff3cd;color:#856404;font-size:11px;padding:1px 6px;border-radius:3px;border:1px solid #ffc107;">stuck &gt;48h</span>' : '';
      const icon = t.done ? '&#10003;' : (isStuck ? '&#9888;' : '&#9633;');
      const iconColor = t.done ? '#2e7d32' : (isStuck ? '#856404' : '#aaa');

      // Verification result for this task (if any doc is linked to this task)
      let verHtml = '';
      for (const [docKey, vr] of Object.entries(verResults)) {
        if (vr && vr.taskId === t._id) {
          const ok = vr.passed;
          verHtml = `<div style="font-size:12px;margin-top:2px;padding:2px 8px;background:${ok ? '#e8f5e9' : '#fce4ec'};border-radius:3px;color:${ok ? '#2e7d32' : '#c62828'};">
            ${ok ? 'PASS' : 'FAIL'}: ${vr.reason || ''}
          </div>`;
        }
      }

      // Mark-done button for incomplete tasks (only when MARK_TASK_SECRET is configured)
      const markBtn = (!t.done && markTaskEnabled)
        ? `<form method="POST" action="/mark-task/${emp.employeeId}/${t._id}" style="display:inline;margin-left:8px;">
            <input type="hidden" name="secret" value="${process.env.MARK_TASK_SECRET}"/>
            <button type="submit" style="font-size:11px;padding:2px 8px;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:3px;cursor:pointer;">Mark done</button>
           </form>`
        : '';

      return `<tr>
        <td style="padding:4px 12px;vertical-align:top;color:${iconColor};font-size:16px;">${icon}</td>
        <td style="padding:4px 8px;color:${t.done ? '#2e7d32' : '#555'}">${t.label}${stuckBadge}${verHtml}${markBtn}</td>
      </tr>`;
    }).join('');

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

  const officialEmailBadge = t16Done && emp.officialEmail
    ? `&nbsp;|&nbsp; Official email: <strong>${emp.officialEmail}</strong>`
    : '';

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
    .progress-bar{background:#e0e0e0;border-radius:8px;height:20px;margin-bottom:8px;}
    .progress-fill{background:#2e7d32;border-radius:8px;height:100%;transition:width .3s;}
    .pct{font-size:13px;color:#555;margin-bottom:24px;}
    table{width:100%;}
    h2{margin-top:32px;font-size:18px;border-bottom:1px solid #eee;padding-bottom:6px;}
    .back{font-size:13px;margin-bottom:16px;}<br/>
  </style>
</head>
<body>
  <div class="back"><a href="/status" style="color:#1a73e8;">&larr; All Employees</a></div>
  <h1>${emp.name}</h1>
  <div class="meta">ID: ${emp.employeeId} &nbsp;|&nbsp; DOJ: ${emp.doj} &nbsp;|&nbsp; ${emp.personalEmail}${officialEmailBadge}</div>
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

// ─── All-employees dashboard ───────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  const employees = Object.values(_employeeRegistry);

  const rows = employees.map(emp => {
    let total = 0, done = 0;
    for (const phase of Object.values(emp.checklist || {})) {
      const tasks = Object.values(phase.tasks || {});
      total += tasks.length;
      done += tasks.filter(t => t.done).length;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    let currentPhase = 'Complete';
    for (const phase of Object.values(emp.checklist || {})) {
      if (phase.tasks && Object.values(phase.tasks).some(t => !t.done)) {
        currentPhase = phase.label;
        break;
      }
    }
    const bar = `<div style="background:#e0e0e0;border-radius:6px;height:10px;width:120px;display:inline-block;vertical-align:middle;"><div style="background:#2e7d32;border-radius:6px;height:100%;width:${pct}%;"></div></div>`;
    return `<tr>
      <td style="padding:8px 12px;"><a href="/status/${emp.employeeId}" style="color:#1a73e8;text-decoration:none;">${emp.employeeId}</a></td>
      <td style="padding:8px 12px;">${emp.name}</td>
      <td style="padding:8px 12px;">${emp.doj}</td>
      <td style="padding:8px 12px;">${bar} <span style="font-size:13px;color:#555;margin-left:6px;">${pct}% (${done}/${total})</span></td>
      <td style="padding:8px 12px;color:#555;font-size:13px;">${currentPhase}</td>
    </tr>`;
  }).join('');

  const empty = employees.length === 0
    ? '<tr><td colspan="5" style="padding:16px;color:#888;text-align:center;">No employees registered yet.</td></tr>'
    : '';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>HR Automation — All Employees</title>
  <style>
    body{font-family:sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#333;}
    h1{margin-bottom:4px;}
    .sub{color:#888;font-size:13px;margin-bottom:24px;}
    table{width:100%;border-collapse:collapse;}
    th{background:#f5f5f5;padding:8px 12px;text-align:left;font-size:13px;border-bottom:2px solid #ddd;}
    tr:hover td{background:#fafafa;}
    td{border-bottom:1px solid #eee;}
  </style>
</head>
<body>
  <h1>Onboarding Dashboard</h1>
  <div class="sub">${employees.length} employee(s) registered &nbsp;&mdash;&nbsp; Uptime: ${Math.floor(process.uptime())}s</div>
  <table>
    <thead><tr><th>ID</th><th>Name</th><th>DOJ</th><th>Progress</th><th>Current Phase</th></tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</body>
</html>`);
});

// ─── Raw state endpoint (debugging) ───────────────────────────────────────────
app.get('/state/:employeeId', (req, res) => {
  const emp = _employeeRegistry[req.params.employeeId];
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const stateFile = path.join(__dirname, '..', `state-${emp.employeeId}.json`);
  if (fs.existsSync(stateFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return res.json(raw);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse state file', detail: e.message });
    }
  }
  // Fall back to in-memory checklist if no persisted state file yet
  res.json({ checklist: emp.checklist, milestonesScheduled: emp.milestonesScheduled || false });
});

// ─── Manual task mark endpoint ─────────────────────────────────────────────────
// POST /mark-task/:employeeId/:taskId
// Header: x-mark-task-secret: <MARK_TASK_SECRET>
// Allows recruiters to mark manual tasks (t53, t54, etc.) done from a browser or curl.
// Disabled if MARK_TASK_SECRET is not set in .env.
app.post('/mark-task/:employeeId/:taskId', (req, res) => {
  const secret = process.env.MARK_TASK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Task marking is disabled — set MARK_TASK_SECRET in .env to enable.' });
  }

  const provided = req.headers['x-mark-task-secret'] || req.body.secret;
  if (provided !== secret) {
    return res.status(401).json({ error: 'Invalid or missing secret token.' });
  }

  const { employeeId, taskId } = req.params;
  const emp = _employeeRegistry[employeeId];
  if (!emp) return res.status(404).json({ error: `Employee ${employeeId} not found.` });

  // Find task across all phases
  let found = false;
  let label = '';
  for (const phase of Object.values(emp.checklist || {})) {
    if (phase.tasks && phase.tasks[taskId] !== undefined) {
      if (phase.tasks[taskId].done) {
        return res.json({ ok: true, message: `Task ${taskId} was already marked done.` });
      }
      phase.tasks[taskId].done = true;
      label = phase.tasks[taskId].label;
      found = true;
      break;
    }
  }

  if (!found) {
    return res.status(404).json({ error: `Task ${taskId} not found in checklist for ${employeeId}.` });
  }

  // Persist state
  try {
    const { log } = require('./activityLog');
    log(emp, `task_done:${taskId}`, `${label} (manually marked via /mark-task)`);
  } catch { /* activityLog is best-effort */ }

  try {
    const stateFile = path.join(__dirname, '..', `state-${employeeId}.json`);
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.checklist) {
        for (const phase of Object.values(state.checklist)) {
          if (phase.tasks && phase.tasks[taskId]) {
            phase.tasks[taskId].done = true;
          }
        }
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      }
    }
  } catch (e) {
    console.warn(`[Webhook] mark-task: state write failed for ${employeeId}:`, e.message);
  }

  console.log(`[Webhook] Task ${taskId} (${label}) manually marked done for ${employeeId}`);

  // If the request came from a browser form, redirect back to the status page
  const accept = req.headers['accept'] || '';
  if (accept.includes('text/html')) {
    return res.redirect(`/status/${employeeId}`);
  }
  res.json({ ok: true, message: `Task ${taskId} marked done for ${emp.name}.`, label });
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
