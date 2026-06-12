require('dotenv').config();
const { getAuthClient, watchFolder, scaffoldEmployeeFolder, uploadChecklist, listFolderFiles } = require('./driveWatcher');
const { verifyDocument, detectDocType } = require('./documentVerifier');
const {
  sendPreOnboardingForm,
  sendDocumentRejection,
  sendNoResponseAlert,
  sendOfficialEmailCreationRequest,
  sendAssetAllocationRequest,
  sendITAssetRequest,
  sendBGVRequest,
  sendHRInductionConfirmation,
  sendPhaseCompletionSummary,
  sendVerificationReport,
  sendInductionCalendarInvite,
  sendProjectIntroInvite,
  sendCatchupXLSEmail,
  sendReviewSummaryRequest,
  sendAdminSeatAllocationRequest,
} = require('./emailSender');
const {
  scheduleAllMilestones,
  scheduleNoResponseAlert,
  scheduleReplyDeadline,
  restoreMilestonesAfterRestart,
  startDailyHealthCheck,
  cancelAllJobs,
} = require('./cronJobs');
const { createHRInductionEvent, createProjectIntroEvent, create30DayCatchupEvent, createReviewEvent } = require('./calendarService');
const webhookServer = require('./webhookServer');
const { registerGmailWatch } = require('./gmailWatcher');
const activityLog = require('./activityLog');
const {
  getOrCreateStatusSheet,
  markPreonboardingInitiated,
  markDocumentsReceived,
  markDocumentIssue,
  markDocumentsVerifiedOk,
  markOfficialEmailConfirmed,
  markManagerConfirmed,
  markITConfirmed,
  markBGVDone,
  markHRInductionScheduled,
  markProjectIntroScheduled,
  markOnboardingComplete,
  mark30DayDone,
  mark60DayDone,
  mark90DayDone,
  markPreprobationDone,
} = require('./statusTracker');

// ─── Employee registry ────────────────────────────────────────────────────────
// In production this would come from a database or a Google Sheet.
// For now it reads from employees.json in the project root if present,
// and falls back to the single employee defined in .env for quick testing.
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..');

function statePathFor(employeeId) {
  return path.join(STATE_DIR, `state-${employeeId}.json`);
}

function loadState(employeeId) {
  // Per-employee file takes priority
  const perFile = statePathFor(employeeId);
  if (fs.existsSync(perFile)) {
    try { return JSON.parse(fs.readFileSync(perFile, 'utf8')); } catch { return null; }
  }
  // One-time migration: check legacy shared state.json
  const legacyPath = path.join(STATE_DIR, 'state.json');
  if (fs.existsSync(legacyPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      if (all[employeeId]) {
        // Migrate this employee out of the legacy file
        fs.writeFileSync(perFile, JSON.stringify(all[employeeId], null, 2));
        console.log(`[State] Migrated ${employeeId} from state.json → state-${employeeId}.json`);
        return all[employeeId];
      }
    } catch { /* ignore */ }
  }
  return null;
}

function saveState(employeeId, data) {
  fs.writeFileSync(statePathFor(employeeId), JSON.stringify(data, null, 2));
}

// Serialize all persistable fields from a live employee object into a plain object
function snapshotEmployee(employee) {
  // Serialise reply timer expiry timestamps AND recipient emails so they can be
  // correctly rescheduled after restart with the right escalation target.
  const replyTimerExpiry = {};
  if (employee.replyTimers) {
    for (const [key, task] of Object.entries(employee.replyTimers)) {
      if (task && task._expiresAt) {
        replyTimerExpiry[key] = {
          expiresAt: task._expiresAt,
          recipientEmail: task._recipientEmail || process.env.HR_EMAIL,
        };
      }
    }
  }
  return {
    checklist: employee.checklist,
    milestonesScheduled: employee.milestonesScheduled || false,
    statusSheetId: employee.statusSheetId || null,
    verificationResults: employee.verificationResults || {},
    replyTimerExpiry,
  };
}

function loadEmployees() {
  const registryPath = path.join(__dirname, '..', 'employees.json');
  if (fs.existsSync(registryPath)) {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  }

  // Single-employee fallback from .env — useful for initial testing
  if (process.env.EMPLOYEE_DRIVE_FOLDER_ID) {
    const employeeId = process.env.EMPLOYEE_ID || 'EMP001';
    const saved = loadState(employeeId);

    return [
      {
        employeeId,
        name: process.env.EMPLOYEE_NAME || 'New Employee',
        personalEmail: process.env.EMPLOYEE_PERSONAL_EMAIL || '',
        officialEmail: process.env.EMPLOYEE_OFFICIAL_EMAIL || '',
        doj: process.env.EMPLOYEE_DOJ || new Date().toISOString().split('T')[0],
        driveFolderId: process.env.EMPLOYEE_DRIVE_FOLDER_ID,
        contacts: {
          recruiterEmail: process.env.RECRUITER_EMAIL || process.env.HR_EMAIL,
          managerEmail: process.env.MANAGER_EMAIL || process.env.HR_EMAIL,
          itEmail: process.env.IT_EMAIL || process.env.HR_EMAIL,
        },
        // Restore checklist from state.json if it exists, otherwise start fresh
        checklist: saved ? saved.checklist : buildDefaultChecklist(),
        milestonesScheduled: saved ? saved.milestonesScheduled : false,
        statusSheetId: saved ? (saved.statusSheetId || null) : null,
        verificationResults: saved ? (saved.verificationResults || {}) : {},
        replyTimerExpiry: saved ? (saved.replyTimerExpiry || {}) : {},
        phase: 'Phase2_BeforeDOJ',
        noResponseTimers: {},
        replyTimers: {},
      },
    ];
  }

  return [];
}

// ─── Default checklist (55 tasks, 7 phases) ───────────────────────────────────
// Matches the full workflow exactly:
//   Phase 1 — Recruiter manual checklist (Before DOJ)
//   Phase 2 — Automation checklist (Before DOJ)
//   Phase 3 — Day of Joining
//   Phase 4 — 30 Days After DOJ
//   Phase 5 — 60 Days After DOJ
//   Phase 6 — 90 Days After DOJ
//   Phase 7 — 5 Months After DOJ
function buildDefaultChecklist() {
  return {
    // ── Phase 1: Recruiter manual tasks (Before DOJ) ──────────────────────────
    // From recruiter checklist image
    phase1: {
      label: 'Phase 1 — Before DOJ (Recruiter)',
      tasks: {
        t1:  { label: 'Candidate accepts offer', done: false },
        t2:  { label: 'Recruiter creates Drive folder with joinee name (as per Aadhaar)', done: false },
        t3:  { label: 'Recruiter triggers automation via form/sheet with joinee details', done: false },
        t13: { label: 'Recruiter uploads signed offer letter into the created folder', done: false },
        t53: { label: 'Recruiter checks documents are saved in the folder', done: false },
      },
    },
    // ── Phase 2: Automation tasks (Before DOJ) ────────────────────────────────
    // From automation checklist image (steps 2–9)
    phase2: {
      label: 'Phase 2 — Before DOJ (Automation)',
      tasks: {
        t4:  { label: 'Pre-onboarding form sent to new joinee', done: false },
        t5:  { label: 'Employee uploads documents to Drive folder', done: false },
        t6:  { label: 'Employee folder created with joinee name and employee ID', done: false },
        t7:  { label: 'Checklist1 created in folder', done: false },
        t8:  { label: 'Sub-folders created and documents organised', done: false },
        t9:  { label: 'Document verification report generated for recruiter', done: false },
        t10: { label: 'Reminder sent to joinee if document incorrect/illegible', done: false },
        t11: { label: 'Alert sent to recruiter — no response from joinee > 24h', done: false },
        t12: { label: 'Document verification marked complete in Checklist1', done: false },
        t14: { label: 'Mail sent to HR to create official email ID and greythr login', done: false },
        t15: { label: 'HR responds with official email ID and greythr confirmation', done: false },
        t16: { label: 'Official email and greythr login marked complete in Checklist1', done: false },
        t17: { label: 'Mail sent to manager for asset/office location/supervisor allocation', done: false },
        t18: { label: 'Manager responds with allocation details', done: false },
        t19: { label: 'Manager allocation marked complete in Checklist1', done: false },
        t20: { label: 'Mail sent to IT team for asset allocation/office location', done: false },
        t21: { label: 'IT team responds with asset and access details', done: false },
        t22: { label: 'IT allocation marked complete in Checklist1', done: false },
        t23: { label: 'Mail sent to recruiter to initiate BGV', done: false },
        t24: { label: 'Recruiter triggers BGV', done: false },
        t25: { label: 'Recruiter responds with BGV report', done: false },
        t26: { label: 'BGV marked complete in Checklist1', done: false },
        t27: { label: 'HR induction scheduled on employee and recruiter calendars', done: false },
        t28: { label: 'HR induction scheduling marked complete in Checklist1', done: false },
        t29: { label: 'Project intro meeting scheduled with manager (post-lunch on DOJ)', done: false },
        t30: { label: 'Meeting reschedule option sent to participants', done: false },
        t31: { label: 'Project intro sheets created and populated', done: false },
        t32: { label: 'Project intro scheduling marked complete in Checklist1', done: false },
      },
    },
    // ── Phase 3: Day of Joining ───────────────────────────────────────────────
    // From DOJ image (steps 1–10)
    phase3: {
      label: 'Phase 3 — Day of Joining',
      tasks: {
        t33: { label: 'Recruiter conducts HR induction', done: false },
        t34: { label: 'Automation confirms HR induction attendance', done: false },
        t35: { label: 'IT team confirms asset and access card allocation', done: false },
        t36: { label: 'General Admin confirms seat allocation', done: false },
        t37: { label: 'Project intro meeting attendance confirmed', done: false },
        t54: { label: 'Recruiter checks asset and seat allocation physically', done: false },
        t38: { label: 'Onboarding survey scheduled for day 25 (working day)', done: false },
        t39: { label: '30-day catchup call scheduled', done: false },
        t40: { label: 'Catchup XLS created, shared with recruiter, saved in joinee folder', done: false },
        t41: { label: '30/60/90-day project reviews scheduled with manager and recruiter', done: false },
        t42: { label: 'Checklist1 updated — DOJ phase complete', done: false },
      },
    },
    // ── Phase 4: 30 Days After DOJ ────────────────────────────────────────────
    // From 30-day image (steps 1–3)
    phase4: {
      label: 'Phase 4 — 30 Days After DOJ',
      tasks: {
        t43: { label: 'Catchup call transcribed and mailed to HR and manager', done: false },
        t44: { label: 'Recruiter catchup XLS verified as filled', done: false },
        t45: { label: '30-day milestone marked complete in Checklist1', done: false },
      },
    },
    // ── Phase 5: 60 Days After DOJ ────────────────────────────────────────────
    // From 60-day image — transcribe call; if didn't happen, mark pending + remind
    phase5: {
      label: 'Phase 5 — 60 Days After DOJ',
      tasks: {
        t46: { label: 'Call between recruiter and manager transcribed and project intro sheet updated', done: false },
        t47: { label: 'Call did not happen — reminder sent to reschedule; marked pending', done: false },
        t48: { label: '60-day milestone marked complete in Checklist1', done: false },
      },
    },
    // ── Phase 6: 90 Days After DOJ ────────────────────────────────────────────
    // Same pattern as 60-day
    phase6: {
      label: 'Phase 6 — 90 Days After DOJ',
      tasks: {
        t49: { label: 'Call between recruiter and manager transcribed and project intro sheet updated', done: false },
        t50: { label: 'Call did not happen — reminder sent to reschedule; marked pending', done: false },
        t51: { label: '90-day milestone marked complete in Checklist1', done: false },
      },
    },
    // ── Phase 7: 5 Months After DOJ ───────────────────────────────────────────
    phase7: {
      label: 'Phase 7 — 5 Months After DOJ (Pre-Probation)',
      tasks: {
        t52: { label: 'Pre-probation verification completed', done: false },
        t55: { label: 'Pre-probation result communicated to manager and HR', done: false },
      },
    },
  };
}

// ─── Checklist helpers ────────────────────────────────────────────────────────
function markTask(checklist, taskId) {
  for (const phase of Object.values(checklist)) {
    if (phase.tasks && phase.tasks[taskId]) {
      if (phase.tasks[taskId].done) return; // already done — no-op
      phase.tasks[taskId].done = true;
      console.log(`[Checklist] ✓ ${phase.tasks[taskId].label}`);
      return;
    }
  }
  console.warn(`[Checklist] Task "${taskId}" not found`);
}

// Mark task done AND write an activity log entry
function markAndLog(employee, taskId) {
  const checklist = employee.checklist;
  for (const phase of Object.values(checklist)) {
    if (phase.tasks && phase.tasks[taskId]) {
      if (phase.tasks[taskId].done) return;
      phase.tasks[taskId].done = true;
      console.log(`[Checklist] ✓ ${phase.tasks[taskId].label}`);
      activityLog.log(employee, `task_done:${taskId}`, phase.tasks[taskId].label);
      return;
    }
  }
  console.warn(`[Checklist] Task "${taskId}" not found`);
}

function isPhaseComplete(checklist, phaseKey) {
  const phase = checklist[phaseKey];
  if (!phase) return false;
  return Object.values(phase.tasks).every(t => t.done);
}

// ─── Document → required field mapping ────────────────────────────────────────
const DOC_TASK_MAP = {
  aadhaar:         't12',
  pan:             't12',
  offerLetter:     't13',
  meetingScreenshot: 't34',
};

// ─── Handler: new file detected in Drive folder ────────────────────────────────
async function handleNewFile(auth, employee, file) {
  const docType = detectDocType(file.name);
  if (!docType) {
    console.log(`[Index] Skipping unrecognised file: ${file.name}`);
    return;
  }

  // t5: employee has uploaded at least one document to the Drive folder
  if (!isTaskDone(employee.checklist, 't5')) {
    markAndLog(employee, 't5');
  }

  console.log(`[Index] Verifying ${file.name} for ${employee.name}`);
  let result;
  try {
    result = await verifyDocument(auth, file.id, file.name, file.mimeType);
  } catch (err) {
    console.error(`[Index] verifyDocument failed for ${file.name}:`, err.message);
    activityLog.log(employee, 'verification_error', `${file.name} — ${err.message}`);
    return false; // signal caller to remove from seen-files so it can be retried
  }

  // Always accumulate verification results for the report (pass or fail)
  employee.verificationResults = employee.verificationResults || {};
  employee.verificationResults[docType] = {
    valid: result.valid,
    summary: result.valid
      ? (result.summary || 'Verification successful')
      : (result.failureReasons ? result.failureReasons.join('; ') : 'Verification failed'),
  };

  // Sheet: mark documents received
  await markDocumentsReceived(auth, employee, docType).catch(() => {});

  if (result.valid) {
    console.log(`[Index] ✓ ${file.name} passed verification`);
    activityLog.log(employee, 'document_verified', `${docType} — ${file.name}`);

    // Mark corresponding checklist task
    const taskId = DOC_TASK_MAP[docType];
    if (taskId) markAndLog(employee, taskId);

    // Cancel any pending no-response timer for this doc type
    if (employee.noResponseTimers[docType]) {
      employee.noResponseTimers[docType].stop();
      delete employee.noResponseTimers[docType];
    }
  } else {
    const reason = result.failureReasons ? result.failureReasons.join('; ') : 'Verification failed';
    console.log(`[Index] ✗ ${file.name} failed: ${reason}`);
    activityLog.log(employee, 'document_rejected', `${docType} — ${file.name} — ${reason}`);

    await sendDocumentRejection(employee, result.docType || docType, reason);
    await markDocumentIssue(auth, employee, result.docType || docType, reason).catch(() => {});

    // t10: reminder sent for incorrect document
    if (!isTaskDone(employee.checklist, 't10')) {
      markAndLog(employee, 't10');
    }

    // Schedule a no-response alert to recruiter if employee doesn't re-upload in 24h
    if (employee.noResponseTimers[docType]) employee.noResponseTimers[docType].stop();
    employee.noResponseTimers[docType] = scheduleNoResponseAlert(
      employee,
      employee.contacts.recruiterEmail
    );
  }

  // Always send the latest verification report to the recruiter (t9)
  try {
    await sendVerificationReport(employee, employee.verificationResults);
    if (!isTaskDone(employee.checklist, 't9')) {
      markAndLog(employee, 't9');
    }
  } catch (err) {
    console.warn('[Index] Could not send verification report:', err.message);
  }

  // Save updated checklist to Drive and locally
  await uploadChecklist(auth, employee.driveFolderId, employee.checklist);
  saveState(employee.employeeId, snapshotEmployee(employee));

  // Trigger next steps based on which document just passed (only if valid)
  if (result.valid) {
    await triggerNextStep(auth, employee, docType);
  }
  return true;
}

// ─── Trigger next automation step after a document passes ─────────────────────
async function triggerNextStep(auth, employee, docType) {
  const { checklist, contacts } = employee;

  // After all identity docs verified → request official email creation (t14)
  if (docType === 'aadhaar' || docType === 'pan') {
    const aadhaarDone = isTaskDone(checklist, 't12');
    if (aadhaarDone && !isTaskDone(checklist, 't14')) {
      await markDocumentsVerifiedOk(auth, employee).catch(() => {});
      await sendOfficialEmailCreationRequest(employee);
      markAndLog(employee, 't14');
      await uploadChecklist(auth, employee.driveFolderId, checklist);

      // Simultaneously send asset allocation request to manager (t17)
      // IT asset request (t20) is sent AFTER manager replies with allocation details
      // so IT receives the full asset type, location, and supervisor info — not an empty request.
      await sendAssetAllocationRequest(employee, contacts.managerEmail);
      markAndLog(employee, 't17');

      // Send BGV request to recruiter (t23 = request sent, t24 = recruiter triggers it)
      await sendBGVRequest(employee, contacts.recruiterEmail);
      markAndLog(employee, 't23');
      markAndLog(employee, 't24');

      await uploadChecklist(auth, employee.driveFolderId, checklist);
      saveState(employee.employeeId, snapshotEmployee(employee));

      // Schedule 48h reply-deadline timers for HR, manager, and BGV.
      // IT timer is started after the manager replies and the IT email is actually sent.
      employee.replyTimers = employee.replyTimers || {};
      employee.replyTimers.hr = scheduleReplyDeadline(employee, 'HR Team', process.env.HR_EMAIL);
      employee.replyTimers.manager = scheduleReplyDeadline(employee, 'Reporting Manager', contacts.managerEmail);
      employee.replyTimers.bgv = scheduleReplyDeadline(employee, 'Recruiter (BGV)', contacts.recruiterEmail);
    }
  }

  // After offer letter saved → send induction confirmation request, calendar invite, project intro
  // t13 is already marked by DOC_TASK_MAP in handleNewFile when the offer letter passes verification
  if (docType === 'offerLetter') {
    if (!isTaskDone(checklist, 't33')) {
      await sendHRInductionConfirmation(employee, contacts.recruiterEmail);
    }

    // t27/t28: Send HR induction calendar invite to employee + recruiter
    if (!isTaskDone(checklist, 't27')) {
      await sendInductionCalendarInvite(employee);
      await createHRInductionEvent(auth, employee).catch(err => {
        console.warn(`[Index] HR induction calendar event failed for ${employee.name} — email invite still sent. (${err.message})`);
        activityLog.log(employee, 'calendar_event_failed', `HR induction: ${err.message}`);
      });
      markAndLog(employee, 't27');
      markAndLog(employee, 't28');
      await markHRInductionScheduled(auth, employee).catch(() => {});
    }

    // t29/t30/t31/t32: Send project intro meeting invite + sheet to manager + employee
    if (!isTaskDone(checklist, 't29')) {
      await sendProjectIntroInvite(employee);
      await createProjectIntroEvent(auth, employee).catch(err => {
        console.warn(`[Index] Project intro calendar event failed for ${employee.name} — email invite still sent. (${err.message})`);
        activityLog.log(employee, 'calendar_event_failed', `Project intro: ${err.message}`);
      });
      markAndLog(employee, 't29');
      markAndLog(employee, 't30');
      markAndLog(employee, 't31');
      markAndLog(employee, 't32');
      await markProjectIntroScheduled(auth, employee).catch(() => {});
    }

    await uploadChecklist(auth, employee.driveFolderId, checklist);
    saveState(employee.employeeId, snapshotEmployee(employee));
  }

  // After meeting screenshot → confirm phase 3 DOJ tasks
  if (docType === 'meetingScreenshot') {
    markAndLog(employee, 't34');
    markAndLog(employee, 't37');
    markAndLog(employee, 't42');
    await uploadChecklist(auth, employee.driveFolderId, checklist);

    // Schedule all timed milestones if not already done
    if (!employee.milestonesScheduled) {
      // Pass markTask wrapper so cron callbacks can update the checklist
      const markTaskForEmployee = (taskId) => markAndLog(employee, taskId);
      scheduleAllMilestones(employee, contacts, markTaskForEmployee);
      employee.milestonesScheduled = true;
      markAndLog(employee, 't38');
      markAndLog(employee, 't39');
      markAndLog(employee, 't41');
      await uploadChecklist(auth, employee.driveFolderId, checklist);
      await markOnboardingComplete(auth, employee).catch(() => {});
      saveState(employee.employeeId, snapshotEmployee(employee));
    }

    // t40: Send catchup XLS tracker email to recruiter + manager
    if (!isTaskDone(checklist, 't40')) {
      await sendCatchupXLSEmail(employee);
      markAndLog(employee, 't40');
      await uploadChecklist(auth, employee.driveFolderId, checklist);
      saveState(employee.employeeId, snapshotEmployee(employee));
    }

    // t35/t36: Send seat allocation request to Admin and schedule 48h escalation timers
    employee.replyTimers = employee.replyTimers || {};
    if (!isTaskDone(checklist, 't35')) {
      employee.replyTimers.itDoj = scheduleReplyDeadline(
        employee, 'IT Team (DOJ Assets)', contacts.itEmail
      );
    }
    if (!isTaskDone(checklist, 't36')) {
      await sendAdminSeatAllocationRequest(employee).catch(err =>
        console.warn(`[Index] Admin seat allocation email failed for ${employee.name}: ${err.message}`)
      );
      employee.replyTimers.admin = scheduleReplyDeadline(
        employee, 'Admin (Seat Allocation)', process.env.HR_EMAIL
      );
    }
    saveState(employee.employeeId, snapshotEmployee(employee));

    if (isPhaseComplete(checklist, 'phase3')) {
      const done = Object.values(checklist.phase3.tasks).map(t => t.label);
      await sendPhaseCompletionSummary(employee, 'Phase 3 — Day of Joining', done);
    }
  }
}

function isTaskDone(checklist, taskId) {
  for (const phase of Object.values(checklist)) {
    if (phase.tasks && phase.tasks[taskId]) return phase.tasks[taskId].done;
  }
  return false;
}

// ─── Handle classified Gmail reply ────────────────────────────────────────────
async function handleReply(auth, classified, rawMsg) {
  const { replyType, employeeId, data } = classified;
  if (!employeeId || !employeeRegistry[employeeId]) {
    console.warn(`[Index] Reply for unknown employee: ${employeeId}`);
    return;
  }

  const employee = employeeRegistry[employeeId];
  const { checklist } = employee;

  console.log(`[Index] Processing reply: ${replyType} for ${employee.name}`);
  activityLog.log(employee, 'reply_received', replyType);

  switch (replyType) {
    case 'official_email_created':
      if (data.officialEmail) {
        employee.officialEmail = data.officialEmail;
        markAndLog(employee, 't15');
        markAndLog(employee, 't16');
        console.log(`[Index] Official email recorded: ${data.officialEmail}`);
        activityLog.log(employee, 'official_email_confirmed', data.officialEmail);
        await markOfficialEmailConfirmed(auth, employee, data.officialEmail).catch(() => {});
        if (employee.replyTimers && employee.replyTimers.hr) {
          employee.replyTimers.hr.stop && employee.replyTimers.hr.stop();
          delete employee.replyTimers.hr;
        }
      } else {
        console.warn(`[Index] official_email_created reply for ${employee.name} had no email address extracted — reply was consumed but checklist not advanced.`);
        activityLog.log(employee, 'official_email_parse_failed', 'Gemini could not extract email from reply');
      }
      break;

    case 'manager_allocation':
      if (data.assetType || data.officeLocation || data.supervisorName) {
        employee.assetDetails = data;
        markAndLog(employee, 't18');
        markAndLog(employee, 't19');
        activityLog.log(employee, 'manager_allocation_confirmed', JSON.stringify(data));
        await markManagerConfirmed(auth, employee, data).catch(() => {});
        if (employee.replyTimers && employee.replyTimers.manager) {
          employee.replyTimers.manager.stop && employee.replyTimers.manager.stop();
          delete employee.replyTimers.manager;
        }
        // Send IT asset request with full allocation details (t20) and start its reply timer
        if (!isTaskDone(employee.checklist, 't20')) {
          await sendITAssetRequest(employee, employee.contacts.itEmail, data);
          markAndLog(employee, 't20');
          employee.replyTimers = employee.replyTimers || {};
          employee.replyTimers.it = scheduleReplyDeadline(employee, 'IT Team', employee.contacts.itEmail);
        }
      } else {
        console.warn(`[Index] manager_allocation reply for ${employee.name} had no allocation data extracted — checklist not advanced.`);
        activityLog.log(employee, 'manager_allocation_parse_failed', 'Gemini could not extract allocation details from reply');
      }
      break;

    case 'it_allocation':
      markAndLog(employee, 't21');
      markAndLog(employee, 't22');
      markAndLog(employee, 't35');
      activityLog.log(employee, 'it_allocation_confirmed');
      await markITConfirmed(auth, employee).catch(() => {});
      if (employee.replyTimers) {
        if (employee.replyTimers.it) {
          employee.replyTimers.it.stop && employee.replyTimers.it.stop();
          delete employee.replyTimers.it;
        }
        if (employee.replyTimers.itDoj) {
          employee.replyTimers.itDoj.stop && employee.replyTimers.itDoj.stop();
          delete employee.replyTimers.itDoj;
        }
      }
      break;

    case 'bgv_report':
      markAndLog(employee, 't25');
      markAndLog(employee, 't26');
      activityLog.log(employee, 'bgv_report_received');
      await markBGVDone(auth, employee).catch(() => {});
      if (employee.replyTimers && employee.replyTimers.bgv) {
        employee.replyTimers.bgv.stop && employee.replyTimers.bgv.stop();
        delete employee.replyTimers.bgv;
      }
      break;

    case 'induction_confirmed':
      markAndLog(employee, 't33');
      markAndLog(employee, 't34');
      activityLog.log(employee, 'induction_confirmed');
      if (employee.replyTimers && employee.replyTimers.induction) {
        employee.replyTimers.induction.stop && employee.replyTimers.induction.stop();
        delete employee.replyTimers.induction;
      }
      break;

    case 'admin_allocation':
      markAndLog(employee, 't36');
      activityLog.log(employee, 'admin_seat_allocation_confirmed');
      if (employee.replyTimers && employee.replyTimers.admin) {
        employee.replyTimers.admin.stop && employee.replyTimers.admin.stop();
        delete employee.replyTimers.admin;
      }
      break;

    case 'catchup_complete':
      markAndLog(employee, 't43');
      markAndLog(employee, 't44');
      markAndLog(employee, 't45');
      activityLog.log(employee, '30_day_catchup_complete');
      await mark30DayDone(auth, employee).catch(() => {});
      if (employee.replyTimers && employee.replyTimers['30dayReview']) {
        employee.replyTimers['30dayReview'].stop && employee.replyTimers['30dayReview'].stop();
        delete employee.replyTimers['30dayReview'];
      }
      break;

    case 'review_complete': {
      const daysSinceDoj = Math.floor(
        (Date.now() - new Date(employee.doj).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceDoj < 75) {
        markAndLog(employee, 't46'); markAndLog(employee, 't48');
        activityLog.log(employee, '60_day_review_complete');
        await mark60DayDone(auth, employee).catch(() => {});
      } else if (daysSinceDoj < 120) {
        markAndLog(employee, 't49'); markAndLog(employee, 't51');
        activityLog.log(employee, '90_day_review_complete');
        await mark90DayDone(auth, employee).catch(() => {});
      }
      break;
    }

    case 'pre_probation_result':
      markAndLog(employee, 't52');
      markAndLog(employee, 't55');
      activityLog.log(employee, 'pre_probation_verified', data.notes || '');
      await markPreprobationDone(auth, employee).catch(() => {});
      console.log(`[Index] Pre-probation result received for ${employee.name}`);
      break;

    default:
      console.log(`[Index] Unhandled reply type: ${replyType}`);
      return;
  }

  await uploadChecklist(auth, employee.driveFolderId, checklist);
  saveState(employee.employeeId, snapshotEmployee(employee));
}

// ─── Employee registry (shared with webhookServer) ────────────────────────────
const employeeRegistry = {};

// ─── Bootstrap an employee when they are first added ──────────────────────────
async function onboardEmployee(auth, employee) {
  // Register in shared registry so webhookServer can look them up
  employeeRegistry[employee.employeeId] = employee;
  // Store auth and markTask helper on employee so cron callbacks can update checklist/sheet
  employee._auth = auth;
  employee._markTask = (taskId) => markAndLog(employee, taskId);

  // Restore reply-deadline timers that were active before restart.
  // Each entry is { expiresAt, recipientEmail } — use the stored recipient so
  // escalations go to the right person (manager, IT, recruiter) not just HR.
  if (employee.replyTimerExpiry) {
    const now = Date.now();
    for (const [key, entry] of Object.entries(employee.replyTimerExpiry)) {
      // Support both old format (plain ISO string) and new format ({ expiresAt, recipientEmail })
      const isoDate = typeof entry === 'string' ? entry : entry.expiresAt;
      const recipientEmail = (typeof entry === 'object' && entry.recipientEmail)
        ? entry.recipientEmail
        : process.env.HR_EMAIL;
      const expiresAt = new Date(isoDate);
      if (expiresAt > now) {
        employee.replyTimers = employee.replyTimers || {};
        employee.replyTimers[key] = scheduleReplyDeadline(
          employee, key, recipientEmail,
          (expiresAt - now) / (60 * 60 * 1000)
        );
        console.log(`[Index] Restored reply-deadline timer "${key}" for ${employee.name} → ${recipientEmail} (fires ${expiresAt.toISOString()})`);
      } else {
        console.log(`[Index] Reply-deadline timer "${key}" for ${employee.name} already expired — skipping`);
      }
    }
  }

  // If milestones were scheduled in a previous run, re-register them after restart
  if (employee.milestonesScheduled && employee.contacts) {
    const completedTasks = [];
    for (const phase of Object.values(employee.checklist)) {
      if (phase.tasks) {
        for (const [id, task] of Object.entries(phase.tasks)) {
          if (task.done) completedTasks.push(id);
        }
      }
    }
    const markTaskForEmployee = (taskId) => markAndLog(employee, taskId);
    restoreMilestonesAfterRestart(employee, employee.contacts, completedTasks, markTaskForEmployee);
  }

  const alreadyStarted = isTaskDone(employee.checklist, 't4');

  if (!alreadyStarted) {
    console.log(`\n[Index] Starting onboarding for ${employee.name} (${employee.employeeId})`);
    activityLog.log(employee, 'onboarding_started', `DOJ: ${employee.doj}`);

    // Step 1: Scaffold Drive folder structure
    try {
      await scaffoldEmployeeFolder(auth, employee.driveFolderId, employee.name, employee.employeeId);
      markAndLog(employee, 't6');
      markAndLog(employee, 't7');
      markAndLog(employee, 't8');
    } catch (err) {
      console.error(`[Index] ✖ Could not scaffold Drive folder for ${employee.name} — check driveFolderId "${employee.driveFolderId}" is correct and accessible. (${err.message})`);
      activityLog.log(employee, 'scaffold_failed', `driveFolderId: ${employee.driveFolderId} — ${err.message}`);
      return; // cannot continue without a working Drive folder
    }

    // Step 2: Create status sheet and mark preonboarding initiated
    await getOrCreateStatusSheet(auth, employee).catch(() => {});
    await markPreonboardingInitiated(auth, employee).catch(() => {});

    // Step 3: Send pre-onboarding form
    if (!employee.personalEmail) {
      console.error(`[Index] Cannot send pre-onboarding form to ${employee.name} — personalEmail is empty. Add it to employees.json and restart.`);
      activityLog.log(employee, 'pre_onboarding_skipped', 'personalEmail missing');
    } else {
      await sendPreOnboardingForm(employee);
      markAndLog(employee, 't4');
      activityLog.log(employee, 'pre_onboarding_email_sent', employee.personalEmail);
    }

    // Step 5: Save checklist to Drive and locally
    await uploadChecklist(auth, employee.driveFolderId, employee.checklist);
    saveState(employee.employeeId, snapshotEmployee(employee));

    // Step 6: Schedule 24h no-response alert
    employee.noResponseTimers['preOnboarding'] = scheduleNoResponseAlert(
      employee,
      employee.contacts.recruiterEmail,
      24
    );

    console.log(`[Index] Onboarding initiated for ${employee.name}\n`);
  } else {
    console.log(`[Index] Resuming onboarding for ${employee.name} (${employee.employeeId}) — already started, skipping welcome email`);
  }

  // Always start watching the Drive folder (push or poll)
  await watchFolder(auth, employee.driveFolderId, employee.employeeId,
    (file) => handleNewFile(auth, employee, file)
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${process.env.COMPANY_NAME} HR Automation Engine`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ─── Critical env var check — fail fast before any API calls ────────────────
  const REQUIRED_VARS = [
    ['GMAIL_USER',         'Gmail address used to send all automated emails'],
    ['GMAIL_APP_PASSWORD', 'Gmail App Password for nodemailer (Settings → Security → App passwords)'],
    ['COMPANY_NAME',       'Company name shown in every email subject and body'],
    ['HR_EMAIL',           'HR team email — receives escalations and reports'],
  ];
  const missing = REQUIRED_VARS.filter(([k]) => !process.env[k]);
  if (missing.length > 0) {
    console.error('\n[Config] FATAL — Missing required environment variables:\n');
    for (const [k, desc] of missing) {
      console.error(`  ✖  ${k.padEnd(22)} ${desc}`);
    }
    console.error('\n[Config] Set these in your .env file and restart.\n');
    process.exit(1);
  }

  // GEMINI_API_KEY is required for document verification and reply classification.
  // Warn (not fatal) so the engine can still run without it during initial testing.
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[Config] WARNING: GEMINI_API_KEY is not set.');
    console.warn('[Config]   Document verification and Gmail reply classification are DISABLED.');
    console.warn('[Config]   All documents will be marked as unverified until the key is added.\n');
  }

  // ─── Optional config warnings ────────────────────────────────────────────
  const surveyLink = process.env.ONBOARDING_SURVEY_LINK || '';
  if (!surveyLink || surveyLink === '#survey-link' || surveyLink.startsWith('#')) {
    console.warn('[Config] WARNING: ONBOARDING_SURVEY_LINK is not set or is a placeholder.');
    console.warn('[Config]   Employees on day 25 will receive an email with a broken survey link.');
    console.warn('[Config]   Set a real Google Form URL in .env to fix this.\n');
  }

  const webhookUrl = process.env.WEBHOOK_BASE_URL || '';
  if (!webhookUrl || webhookUrl.includes('your-ngrok-url') || webhookUrl.includes('localhost')) {
    console.warn('[Config] WARNING: WEBHOOK_BASE_URL is not set to a public URL.');
    console.warn('[Config]   Drive push notifications will not work — falling back to polling.\n');
  }

  if (!process.env.PREONBOARDING_FORM_LINK) {
    console.warn('[Config] WARNING: PREONBOARDING_FORM_LINK is not set.');
    console.warn('[Config]   Welcome email will show a warning instead of a form link.\n');
  }

  const auth = getAuthClient();

  // Start webhook server (must come before onboarding so registry is available)
  webhookServer.init({
    auth,
    employeeRegistry,
    cancelAllJobs,
    handleNewFile: (a, emp, file) => handleNewFile(a, emp, file),
    handleReply: (classified, rawMsg) => handleReply(auth, classified, rawMsg),
    onNewEmployee: async (data) => {
      const dojDate = new Date(data.doj);
      if (!data.doj || isNaN(dojDate.getTime())) {
        console.error(`[Index] onNewEmployee rejected — invalid DOJ "${data.doj}" for ${data.name}. Use YYYY-MM-DD format.`);
        return;
      }
      const saved = loadState(data.employeeId);
      const employee = {
        ...data,
        checklist: saved ? saved.checklist : buildDefaultChecklist(),
        milestonesScheduled: saved ? (saved.milestonesScheduled || false) : false,
        statusSheetId: saved ? (saved.statusSheetId || null) : null,
        verificationResults: saved ? (saved.verificationResults || {}) : {},
        replyTimerExpiry: saved ? (saved.replyTimerExpiry || {}) : {},
        noResponseTimers: {},
        replyTimers: {},
      };
      await onboardEmployee(auth, employee);
    },
  });
  webhookServer.start();

  // Register Gmail watch if Pub/Sub topic is configured
  if (process.env.GMAIL_PUBSUB_TOPIC) {
    try {
      await registerGmailWatch(auth);
    } catch (err) {
      console.warn('[Index] Gmail watch registration failed:', err.message);
      console.warn('[Index] Reply-parsing disabled — check GMAIL_PUBSUB_TOPIC in .env');
    }
  } else {
    console.warn('[Index] GMAIL_PUBSUB_TOPIC not set — Gmail reply parsing disabled');
  }

  const employees = loadEmployees();

  if (employees.length === 0) {
    console.warn('[Index] No employees loaded. POST to /employee or set EMPLOYEE_* env vars.');
  } else {
    console.log(`[Index] Loaded ${employees.length} employee(s)\n`);
    for (const employee of employees) {
      // Validate DOJ before doing anything — an invalid date breaks all milestone math
      const dojDate = new Date(employee.doj);
      if (!employee.doj || isNaN(dojDate.getTime())) {
        console.error(`[Index] Skipping ${employee.name} (${employee.employeeId}) — invalid or missing DOJ: "${employee.doj}". Fix employees.json and restart.`);
        continue;
      }

      const saved = loadState(employee.employeeId);
      if (!employee.checklist) employee.checklist = saved ? saved.checklist : buildDefaultChecklist();
      if (!employee.statusSheetId && saved && saved.statusSheetId) employee.statusSheetId = saved.statusSheetId;
      if (saved && saved.milestonesScheduled && !employee.milestonesScheduled) employee.milestonesScheduled = true;
      if (saved && saved.verificationResults) employee.verificationResults = saved.verificationResults;
      if (saved && saved.replyTimerExpiry) employee.replyTimerExpiry = saved.replyTimerExpiry;
      if (!employee.noResponseTimers) employee.noResponseTimers = {};
      if (!employee.replyTimers) employee.replyTimers = {};
      if (!employee.verificationResults) employee.verificationResults = {};
      await onboardEmployee(auth, employee);
    }
  }

  // Start daily health-check cron
  startDailyHealthCheck();

  process.on('SIGINT', () => {
    console.log('\n[Index] Shutting down gracefully...');
    // Save state for all employees
    for (const employee of Object.values(employeeRegistry)) {
      try {
        saveState(employee.employeeId, snapshotEmployee(employee));
        console.log(`[Index] State saved for ${employee.name}`);
      } catch (err) {
        console.error(`[Index] Failed to save state for ${employee.name}:`, err.message);
      }
    }
    console.log('[Index] All states saved. Goodbye.');
    process.exit(0);
  });

  console.log('[Index] Engine running. Press Ctrl+C to stop.\n');
}

main().catch(err => {
  const isAuthError =
    err.message && (
      err.message.includes('invalid_grant') ||
      err.message.includes('Token has been expired') ||
      err.message.includes('token.json not found') ||
      (err.code === 401)
    );
  if (isAuthError) {
    console.error('\n[Auth] ✖ OAuth token is expired or invalid.');
    console.error('[Auth]   Delete token.json and re-run:  npm run auth\n');
  } else {
    console.error('[Index] Fatal error:', err.message);
  }
  process.exit(1);
});
