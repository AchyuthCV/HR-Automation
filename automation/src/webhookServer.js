// Express webhook server — receives push notifications from:
//   POST /drive-push       ← Google Drive file change notifications
//   POST /gmail-push       ← Gmail inbox change notifications (via Pub/Sub)
//   POST /employee         ← HR adds a new employee (triggers onboarding)
//   POST /recruiter-form   ← Google Apps Script form submit trigger (recruiter form)
//   GET  /health           ← uptime check

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getChangedFiles, loadPushChannels } = require('./driveWatcher');
const { processGmailPush } = require('./gmailWatcher');
const config = require('./config');

// ─── Input validation helpers ─────────────────────────────────────────────────
// employeeId: alphanumeric + hyphen/underscore, 1-32 chars
function isValidEmployeeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(id);
}
// taskId: t followed by 1-3 digits
function isValidTaskId(id) {
  return typeof id === 'string' && /^t\d{1,3}$/.test(id);
}
// Basic email sanity check
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]{1,64}@[^\s@]{1,253}$/.test(email);
}
// Timing-safe secret comparison to prevent timing attacks
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still run crypto.timingSafeEqual on equal-length copies to avoid length leak
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Per-endpoint in-memory rate limiter (no extra dep needed) ────────────────
// Tracks request counts per IP in a rolling 60-second window.
function makeRateLimiter(maxPerMinute) {
  const counts = new Map(); // ip → { count, windowStart }
  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = counts.get(ip);
    if (!entry || now - entry.windowStart > 60_000) {
      counts.set(ip, { count: 1, windowStart: now });
      return next();
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests — try again in a minute.' });
    }
    next();
  };
}

const employeeCreateLimiter = makeRateLimiter(10);   // 10 new employees/min per IP
const markTaskLimiter       = makeRateLimiter(30);   // 30 mark-task calls/min per IP
const statusLimiter         = makeRateLimiter(60);   // 60 page views/min per IP

const SEEN_FILES_PATH = path.join(__dirname, '..', 'seen-files.json');

// employeeRegistry and handleNewFile are injected by index.js after boot
let _auth = null;
let _employeeRegistry = {};     // { [employeeId]: employee }
let _handleNewFile = null;      // async (auth, employee, file) => void
let _handleReply = null;        // async (classified, rawMessage) => void
let _onNewEmployee = null;      // async (employeeData) => void

let _cancelAllJobs = null; // injected by index.js
let _saveState = null;     // injected by index.js

function init({ auth, employeeRegistry, handleNewFile, handleReply, onNewEmployee, cancelAllJobs, saveState }) {
  _auth = auth;
  _employeeRegistry = employeeRegistry;
  _handleNewFile = handleNewFile;
  _handleReply = handleReply;
  _onNewEmployee = onNewEmployee;
  _cancelAllJobs = cancelAllJobs || null;
  _saveState = saveState || null;
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

// ─── Security headers (no helmet dep — set manually) ──────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Limit request body to 1 MB to prevent memory exhaustion
app.use(express.json({ limit: '1mb' }));
// Gmail Pub/Sub sends raw body — parse it too (same 1 MB cap)
app.use(express.raw({ type: 'application/json', limit: '1mb' }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', statusLimiter, (_req, res) => {
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

// ─── Employees list — internal use only, no PII emails exposed ─────────────────
app.get('/employees', statusLimiter, (_req, res) => {
  const list = Object.values(_employeeRegistry).map(emp => ({
    employeeId: emp.employeeId,
    name: emp.name,
    doj: emp.doj,
    milestonesScheduled: emp.milestonesScheduled || false,
  }));
  res.json({ count: list.length, employees: list });
});

// ─── Drive push handler ────────────────────────────────────────────────────────
// Google sends a POST with headers X-Goog-Channel-Token (= employeeId) and
// X-Goog-Resource-State ('sync' on register, 'update'/'add' on change).
app.post('/drive-push', async (req, res) => {
  // Always respond 200 immediately — Google retries on non-2xx
  res.sendStatus(200);

  // Verify channel token matches a known employee — reject spoofed pushes.
  // Subfolder channels use tokens like "EMP001_Aadhaar" — strip the suffix to get the base ID.
  const rawToken = req.headers['x-goog-channel-token'];
  const employeeId = rawToken ? rawToken.split('_')[0] : null;
  if (!employeeId || !isValidEmployeeId(employeeId) || !_employeeRegistry[employeeId]) {
    console.warn(`[Webhook] Drive push rejected — unknown or invalid channel token: ${rawToken}`);
    return;
  }

  const state = req.headers['x-goog-resource-state'];
  // 'sync' is the handshake ping — nothing to do
  if (state === 'sync') {
    console.log(`[Webhook] Drive sync handshake for ${employeeId}`);
    return;
  }

  const employee = _employeeRegistry[employeeId];
  if (!seenFileIds[employeeId]) seenFileIds[employeeId] = new Set();

  try {
    // Fetch files modified within the configured lookback window (push doesn't tell us which file)
    const sinceMs = Date.now() - config.driveChangeLookbackMs;
    const files = await getChangedFiles(_auth, employee.driveFolderId, sinceMs);

    for (const file of files) {
      if (!seenFileIds[employeeId].has(file.id)) {
        seenFileIds[employeeId].add(file.id);
        saveSeenFiles(seenFileIds);
        console.log(`[Webhook] Drive push → new file: ${file.name} for ${employee.name}`);
        const ok = await _handleNewFile(_auth, employee, file).catch(err => {
          console.error(`[Webhook] handleNewFile error:`, err.message);
          return false;
        });
        // On transient error (false return), remove from cache so the file is retried next push
        if (ok === false) {
          seenFileIds[employeeId].delete(file.id);
          saveSeenFiles(seenFileIds);
          console.log(`[Webhook] File ${file.name} removed from seen-cache — will retry on next push`);
        }
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

  // Verify the Pub/Sub subscription name matches our configured subscription,
  // preventing spoofed pushes from other projects or unknown subscriptions.
  const expectedSub = process.env.PUBSUB_SUBSCRIPTION_NAME;
  if (expectedSub && body.subscription && body.subscription !== expectedSub) {
    console.warn(`[Webhook] Gmail push rejected — unexpected subscription: ${body.subscription}`);
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
app.post('/employee', employeeCreateLimiter, async (req, res) => {
  const required = ['employeeId', 'name', 'personalEmail', 'doj', 'driveFolderId'];
  const missing = required.filter(f => !req.body[f]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  // Strict format validation
  if (!isValidEmployeeId(req.body.employeeId)) {
    return res.status(400).json({ error: 'Invalid employeeId — use only letters, digits, hyphens, underscores (max 32 chars).' });
  }
  if (typeof req.body.name !== 'string' || req.body.name.trim().length < 1 || req.body.name.length > 120) {
    return res.status(400).json({ error: 'Invalid name — must be 1–120 characters.' });
  }
  if (!isValidEmail(req.body.personalEmail)) {
    return res.status(400).json({ error: 'Invalid personalEmail format.' });
  }
  if (!req.body.doj || isNaN(new Date(req.body.doj).getTime())) {
    return res.status(400).json({ error: 'Invalid doj — use YYYY-MM-DD format.' });
  }
  if (typeof req.body.driveFolderId !== 'string' || !/^[A-Za-z0-9_-]{10,60}$/.test(req.body.driveFolderId)) {
    return res.status(400).json({ error: 'Invalid driveFolderId format.' });
  }

  // Validate contacts sub-object — all three are required for escalation emails to reach the right people
  const contacts = req.body.contacts || {};
  const missingContacts = ['recruiterEmail', 'managerEmail', 'itEmail'].filter(f => !contacts[f]);
  if (missingContacts.length) {
    return res.status(400).json({
      error: `Missing contacts fields: ${missingContacts.map(f => `contacts.${f}`).join(', ')}`,
    });
  }
  for (const field of ['recruiterEmail', 'managerEmail', 'itEmail']) {
    if (!isValidEmail(contacts[field])) {
      return res.status(400).json({ error: `Invalid email format for contacts.${field}` });
    }
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

// ─── Recruiter Google Form webhook ────────────────────────────────────────────
// Google Apps Script POSTs here when a recruiter submits the New Joinee form.
// Maps form fields → /employee payload and triggers onboarding automatically.
// Body fields (from createRecruiterForm.gs onRecruiterFormSubmit):
//   name, employeeId, personalEmail, doj, isFresher, managerName, managerEmail,
//   itEmail, officeLocation, assetRequired, designation, team, driveFolderId,
//   recruiterEmail, notes
app.post('/recruiter-form', employeeCreateLimiter, async (req, res) => {
  const {
    name, employeeId, personalEmail, phoneNumber, doj, isFresher,
    managerName, managerEmail, itEmail,
    officeLocation, assetRequired, designation,
    driveFolderId, recruiterEmail,
  } = req.body || {};

  // Required field validation — driveFolderId is optional; falls back to ONBOARDING_ROOT_FOLDER_ID from .env
  const required = { name, employeeId, personalEmail, doj, managerEmail, itEmail };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }
  if (!isValidEmployeeId(employeeId)) {
    return res.status(400).json({ error: 'Invalid employeeId — use only letters, digits, hyphens, underscores (max 32 chars).' });
  }
  if (!isValidEmail(personalEmail))  return res.status(400).json({ error: 'Invalid personalEmail format.' });
  if (!isValidEmail(managerEmail))   return res.status(400).json({ error: 'Invalid managerEmail format.' });
  if (!isValidEmail(itEmail))        return res.status(400).json({ error: 'Invalid itEmail format.' });
  if (recruiterEmail && !isValidEmail(recruiterEmail)) {
    return res.status(400).json({ error: 'Invalid recruiterEmail format.' });
  }
  if (!doj || isNaN(new Date(doj).getTime())) {
    return res.status(400).json({ error: 'Invalid doj — use YYYY-MM-DD format.' });
  }

  // Resolve Drive folder ID — form value takes priority, falls back to env
  const resolvedFolderId = (driveFolderId && driveFolderId.trim()) || process.env.ONBOARDING_ROOT_FOLDER_ID;
  if (!resolvedFolderId || !/^[A-Za-z0-9_-]{10,60}$/.test(resolvedFolderId)) {
    return res.status(400).json({ error: 'No valid Drive folder ID — provide one in the form or set ONBOARDING_ROOT_FOLDER_ID in .env.' });
  }

  if (_employeeRegistry[employeeId]) {
    return res.status(409).json({ error: `Employee ${employeeId} is already registered.` });
  }

  // Build the employee object the same way /employee does
  const employeeData = {
    employeeId,
    name: name.trim(),
    personalEmail,
    phoneNumber: phoneNumber || '',
    doj,
    driveFolderId: resolvedFolderId,
    designation: designation || '',
    officeLocation: officeLocation || '',
    isFresher: isFresher === true || isFresher === 'true',
    assetRequired: assetRequired || 'Unaware — To be confirmed',
    contacts: {
      recruiterEmail: recruiterEmail || process.env.HR_EMAIL,
      managerName: managerName || '',
      managerEmail,
      itEmail,
    },
  };

  console.log(`[Webhook] /recruiter-form — received submission for ${name} (${employeeId}), DOJ: ${doj}`);

  try {
    if (_onNewEmployee) await _onNewEmployee(employeeData);
    res.status(201).json({ message: `Onboarding started for ${name}` });
  } catch (err) {
    console.error('[Webhook] /recruiter-form error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pre-onboarding personal details from form submit ────────────────────────
// Google Apps Script POSTs here when the new joinee submits their pre-onboarding form.
// Stores the personal details on the employee object and saves state.
app.post('/preonboarding-details', async (req, res) => {
  const { employeeId, personalDetails } = req.body || {};
  if (!employeeId || !personalDetails) {
    return res.status(400).json({ error: 'Missing employeeId or personalDetails' });
  }
  const emp = _employeeRegistry[employeeId];
  if (!emp) {
    return res.status(404).json({ error: `Employee ${employeeId} not found in registry` });
  }
  emp.personalDetails = Object.assign(emp.personalDetails || {}, personalDetails);
  if (_saveState) _saveState(employeeId, emp);
  console.log(`[Webhook] /preonboarding-details — saved personal details for ${employeeId}`);
  res.status(200).json({ message: 'Personal details saved' });
});

// ─── Remove employee from running engine ───────────────────────────────────────
// DELETE /employee/:id — cancels cron jobs + reply timers, removes from registry.
// Complements the remove-employee CLI script (which handles file/Drive cleanup).
app.delete('/employee/:id', (req, res) => {
  const { id } = req.params;
  if (!isValidEmployeeId(id)) return res.status(400).json({ error: 'Invalid employee ID format.' });
  const emp = _employeeRegistry[id];
  if (!emp) {
    return res.status(404).json({ error: `Employee ${id} not found in registry.` });
  }

  // Stop all reply timers
  if (emp.replyTimers) {
    for (const timer of Object.values(emp.replyTimers)) {
      if (timer && typeof timer.stop === 'function') timer.stop();
    }
  }
  // Stop all no-response timers
  if (emp.noResponseTimers) {
    for (const timer of Object.values(emp.noResponseTimers)) {
      if (timer && typeof timer.stop === 'function') timer.stop();
    }
  }
  // Cancel all cron milestone jobs
  if (_cancelAllJobs) _cancelAllJobs(id);

  // Persist final state (timers cleared) before dropping from registry
  try {
    const { encrypt, isEncryptionEnabled } = require('./encryption');
    const fs = require('fs');
    const path = require('path');
    const statePath = path.join(__dirname, '..', `state-${id}.json`);
    if (fs.existsSync(statePath)) {
      const plaintext = JSON.stringify({
        checklist: emp.checklist,
        milestonesScheduled: emp.milestonesScheduled || false,
        statusSheetId: emp.statusSheetId || null,
        verificationResults: emp.verificationResults || {},
        replyTimerExpiry: {},
      }, null, 2);
      const payload = isEncryptionEnabled() ? encrypt(plaintext) : plaintext;
      fs.writeFileSync(statePath, payload);
    }
  } catch (err) {
    console.warn(`[Webhook] Could not persist final state for ${id}: ${err.message}`);
  }

  delete _employeeRegistry[id];
  console.log(`[Webhook] Employee ${id} (${emp.name}) removed from running engine.`);
  res.json({ ok: true, message: `${emp.name} (${id}) removed. Run remove-employee CLI to clean up files.` });
});

// ─── Employee status page ──────────────────────────────────────────────────────
app.get('/status/:employeeId', statusLimiter, (req, res) => {
  if (!isValidEmployeeId(req.params.employeeId)) return res.status(400).send('<h2>Invalid employee ID</h2>');
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
    .back{font-size:13px;margin-bottom:16px;}
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
app.get('/status', statusLimiter, (_req, res) => {
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
app.get('/state/:employeeId', statusLimiter, (req, res) => {
  if (!isValidEmployeeId(req.params.employeeId)) return res.status(400).json({ error: 'Invalid employee ID format.' });
  const emp = _employeeRegistry[req.params.employeeId];
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const stateFile = path.join(__dirname, '..', `state-${emp.employeeId}.json`);
  if (fs.existsSync(stateFile)) {
    try {
      const { decrypt, isEncryptionEnabled } = require('./encryption');
      const raw = fs.readFileSync(stateFile, 'utf8');
      const parsed = (isEncryptionEnabled() && raw.includes('"ciphertext"'))
        ? JSON.parse(decrypt(raw))
        : JSON.parse(raw);
      return res.json(parsed);
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
app.post('/mark-task/:employeeId/:taskId', markTaskLimiter, (req, res) => {
  const secret = process.env.MARK_TASK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Task marking is disabled — set MARK_TASK_SECRET in .env to enable.' });
  }

  const provided = req.headers['x-mark-task-secret'] || (req.body && req.body.secret) || '';
  if (!safeCompare(provided, secret)) {
    return res.status(401).json({ error: 'Invalid or missing secret token.' });
  }

  const { employeeId, taskId } = req.params;
  if (!isValidEmployeeId(employeeId)) {
    return res.status(400).json({ error: 'Invalid employeeId format.' });
  }
  if (!isValidTaskId(taskId)) {
    return res.status(400).json({ error: 'Invalid taskId format.' });
  }

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
    const { encrypt: enc, decrypt: dec, isEncryptionEnabled: encOn } = require('./encryption');
    const stateFile = path.join(__dirname, '..', `state-${employeeId}.json`);
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, 'utf8');
      const state = (encOn() && raw.includes('"ciphertext"')) ? JSON.parse(dec(raw)) : JSON.parse(raw);
      if (state.checklist) {
        for (const phase of Object.values(state.checklist)) {
          if (phase.tasks && phase.tasks[taskId]) {
            phase.tasks[taskId].done = true;
          }
        }
        const plaintext = JSON.stringify(state, null, 2);
        fs.writeFileSync(stateFile, encOn() ? enc(plaintext) : plaintext);
      }
    }
  } catch (e) {
    console.warn(`[Webhook] mark-task: state write failed for ${employeeId}:`, e.message);
  }

  console.log(`[Webhook] Task ${taskId} (${label}) manually marked done for ${employeeId}`);

  // Sync updated checklist back to Drive so the file in the employee's folder stays current
  if (_auth && emp.driveFolderId) {
    const { uploadChecklist } = require('./driveWatcher');
    uploadChecklist(_auth, emp.driveFolderId, emp.checklist).catch(err =>
      console.warn(`[Webhook] mark-task: Drive checklist sync failed for ${employeeId}:`, err.message)
    );
  }

  // If the request came from a browser form, redirect back to the status page
  const accept = req.headers['accept'] || '';
  if (accept.includes('text/html')) {
    return res.redirect(`/status/${employeeId}`);
  }
  res.json({ ok: true, message: `Task ${taskId} marked done for ${emp.name}.`, label });
});

// ─── Start the server ──────────────────────────────────────────────────────────
function start(port) {
  const p = port || parseInt(process.env.WEBHOOK_PORT, 10) || 3000;
  app.listen(p, () => {
    console.log(`[Webhook] Server listening on port ${p}`);
    console.log(`[Webhook] Drive push endpoint: ${process.env.WEBHOOK_BASE_URL || 'http://localhost:' + p}/drive-push`);
    console.log(`[Webhook] Gmail push endpoint: ${process.env.WEBHOOK_BASE_URL || 'http://localhost:' + p}/gmail-push`);
  });
  return app;
}

module.exports = { init, start };
