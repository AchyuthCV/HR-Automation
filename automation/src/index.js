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
} = require('./emailSender');
const {
  scheduleAllMilestones,
  scheduleNoResponseAlert,
  scheduleReplyDeadline,
  restoreMilestonesAfterRestart,
  startDailyHealthCheck,
} = require('./cronJobs');
const webhookServer = require('./webhookServer');
const { registerGmailWatch } = require('./gmailWatcher');
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

const STATE_PATH = path.join(__dirname, '..', 'state.json');

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  }
  return {};
}

function saveState(employeeId, data) {
  const state = loadState();
  state[employeeId] = data;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadEmployees() {
  const registryPath = path.join(__dirname, '..', 'employees.json');
  if (fs.existsSync(registryPath)) {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  }

  // Single-employee fallback from .env — useful for initial testing
  if (process.env.EMPLOYEE_DRIVE_FOLDER_ID) {
    const employeeId = process.env.EMPLOYEE_ID || 'EMP001';
    const savedState = loadState();
    const saved = savedState[employeeId];

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
        phase: 'Phase2_BeforeDOJ',
        noResponseTimers: {},
        replyTimers: {},
        verificationResults: {},
      },
    ];
  }

  return [];
}

// ─── Default checklist (71 tasks, 8 phases) ───────────────────────────────────
function buildDefaultChecklist() {
  return {
    phase1: {
      label: 'Phase 1 — Before DOJ (Recruiter)',
      tasks: {
        t1: { label: 'Candidate accepts offer', done: false },
        t2: { label: 'Recruiter creates Drive folder', done: false },
        t3: { label: 'Recruiter submits details via form/sheet', done: false },
      },
    },
    phase2: {
      label: 'Phase 2 — Before DOJ (Automation)',
      tasks: {
        t4:  { label: 'Pre-onboarding form sent to new joinee', done: false },
        t5:  { label: 'Attachments from form read by automation', done: false },
        t6:  { label: 'Employee folder created', done: false },
        t7:  { label: 'Checklist1 created', done: false },
        t8:  { label: 'Sub-folders and documents organised', done: false },
        t9:  { label: 'Recruiter verification report generated', done: false },
        t10: { label: 'Reminder sent if document incorrect/illegible', done: false },
        t11: { label: 'Alert sent to recruiter if no response > 24h', done: false },
        t12: { label: 'Document verification completed', done: false },
        t13: { label: 'Signed offer letter saved by recruiter', done: false },
        t14: { label: 'Mail to HR to create official email + greythr', done: false },
        t15: { label: 'HR responds with official email + greythr confirmation', done: false },
        t16: { label: 'Official email creation marked complete', done: false },
        t17: { label: 'Mail to manager for asset/office/supervisor allocation', done: false },
        t18: { label: 'Manager responds with allocation details', done: false },
        t19: { label: 'Manager allocation marked complete', done: false },
        t20: { label: 'Mail to IT for asset allocation', done: false },
        t21: { label: 'IT responds with asset confirmation', done: false },
        t22: { label: 'IT allocation marked complete', done: false },
        t23: { label: 'Mail to recruiter to initiate BGV', done: false },
        t24: { label: 'Recruiter triggers BGV', done: false },
        t25: { label: 'Recruiter shares BGV report', done: false },
        t26: { label: 'BGV marked complete', done: false },
        t27: { label: 'HR induction scheduled on calendars', done: false },
        t28: { label: 'Induction scheduling marked complete', done: false },
        t29: { label: 'Project intro meeting scheduled with manager', done: false },
        t30: { label: 'Meeting schedule change option provided', done: false },
        t31: { label: 'Project intro sheets created and populated', done: false },
        t32: { label: 'Project intro marked complete', done: false },
      },
    },
    phase3: {
      label: 'Phase 3 — Day of Joining',
      tasks: {
        t33: { label: 'Recruiter conducts HR induction', done: false },
        t34: { label: 'HR induction attendance confirmed', done: false },
        t35: { label: 'IT confirms asset and access card allocation', done: false },
        t36: { label: 'Admin confirms seat allocation', done: false },
        t37: { label: 'Project intro meeting attendance confirmed', done: false },
        t38: { label: 'Onboarding survey scheduled for day 25', done: false },
        t39: { label: '30-day catchup call scheduled', done: false },
        t40: { label: 'Catchup XLS created and shared', done: false },
        t41: { label: '30/60/90-day reviews scheduled with manager and recruiter', done: false },
        t42: { label: 'DOJ checklist updated', done: false },
      },
    },
    phase4: {
      label: 'Phase 4 — 30 Days After DOJ',
      tasks: {
        t43: { label: 'Call transcribed and mailed to HR and manager', done: false },
        t44: { label: 'Recruiter catchup XLS verified as filled', done: false },
        t45: { label: '30-day milestone marked complete', done: false },
      },
    },
    phase5: {
      label: 'Phase 5 — 60 Days After DOJ',
      tasks: {
        t46: { label: 'Call between recruiter and manager transcribed', done: false },
        t47: { label: 'Reminder sent if call did not happen', done: false },
        t48: { label: '60-day milestone closed', done: false },
      },
    },
    phase6: {
      label: 'Phase 6 — 90 Days After DOJ',
      tasks: {
        t49: { label: 'Call between recruiter and manager transcribed', done: false },
        t50: { label: 'Reminder sent if call did not happen', done: false },
        t51: { label: '90-day milestone closed', done: false },
      },
    },
    phase7: {
      label: 'Phase 7 — 5 Months After DOJ',
      tasks: {
        t52: { label: 'Pre-probation verification completed', done: false },
      },
    },
  };
}

// ─── Checklist helpers ────────────────────────────────────────────────────────
function markTask(checklist, taskId) {
  for (const phase of Object.values(checklist)) {
    if (phase.tasks && phase.tasks[taskId]) {
      phase.tasks[taskId].done = true;
      console.log(`[Checklist] ✓ ${phase.tasks[taskId].label}`);
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

  console.log(`[Index] Verifying ${file.name} for ${employee.name}`);
  const result = await verifyDocument(auth, file.id, file.name, file.mimeType);

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

    // Mark corresponding checklist task
    const taskId = DOC_TASK_MAP[docType];
    if (taskId) markTask(employee.checklist, taskId);

    // Cancel any pending no-response timer for this doc type
    if (employee.noResponseTimers[docType]) {
      employee.noResponseTimers[docType].stop();
      delete employee.noResponseTimers[docType];
    }
  } else {
    const reason = result.failureReasons ? result.failureReasons.join('; ') : 'Verification failed';
    console.log(`[Index] ✗ ${file.name} failed: ${reason}`);

    await sendDocumentRejection(employee, result.docType || docType, reason);
    await markDocumentIssue(auth, employee, result.docType || docType, reason).catch(() => {});

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
      markTask(employee.checklist, 't9');
    }
  } catch (err) {
    console.warn('[Index] Could not send verification report:', err.message);
  }

  // Save updated checklist to Drive and locally
  await uploadChecklist(auth, employee.driveFolderId, employee.checklist);
  saveState(employee.employeeId, { checklist: employee.checklist, milestonesScheduled: employee.milestonesScheduled || false });

  // Trigger next steps based on which document just passed (only if valid)
  if (result.valid) {
    await triggerNextStep(auth, employee, docType);
  }
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
      markTask(checklist, 't14');
      await uploadChecklist(auth, employee.driveFolderId, checklist);

      // Simultaneously send asset allocation request to manager (t17)
      await sendAssetAllocationRequest(employee, contacts.managerEmail);
      markTask(checklist, 't17');

      // Send IT asset request (t20)
      await sendITAssetRequest(employee, contacts.itEmail, {});
      markTask(checklist, 't20');

      // Send BGV request to recruiter (t23)
      await sendBGVRequest(employee, contacts.recruiterEmail);
      markTask(checklist, 't23');

      await uploadChecklist(auth, employee.driveFolderId, checklist);
      saveState(employee.employeeId, { checklist, milestonesScheduled: employee.milestonesScheduled || false });

      // Schedule 48h reply-deadline timers for each stakeholder
      employee.replyTimers = employee.replyTimers || {};
      employee.replyTimers.hr = scheduleReplyDeadline(employee, 'HR Team', process.env.HR_EMAIL);
      employee.replyTimers.manager = scheduleReplyDeadline(employee, 'Reporting Manager', contacts.managerEmail);
      employee.replyTimers.it = scheduleReplyDeadline(employee, 'IT Team', contacts.itEmail);
      employee.replyTimers.bgv = scheduleReplyDeadline(employee, 'Recruiter (BGV)', contacts.recruiterEmail);
    }
  }

  // After offer letter saved → send induction confirmation request, calendar invite, project intro
  if (docType === 'offerLetter') {
    markTask(checklist, 't13');
    if (!isTaskDone(checklist, 't33')) {
      await sendHRInductionConfirmation(employee, contacts.recruiterEmail);
    }

    // t27/t28: Send HR induction calendar invite to employee + recruiter
    if (!isTaskDone(checklist, 't27')) {
      await sendInductionCalendarInvite(employee);
      markTask(checklist, 't27');
      markTask(checklist, 't28');
      await markHRInductionScheduled(auth, employee).catch(() => {});
    }

    // t29/t30/t31/t32: Send project intro meeting invite + sheet to manager + employee
    if (!isTaskDone(checklist, 't29')) {
      await sendProjectIntroInvite(employee);
      markTask(checklist, 't29');
      markTask(checklist, 't30');
      markTask(checklist, 't31');
      markTask(checklist, 't32');
      await markProjectIntroScheduled(auth, employee).catch(() => {});
    }

    await uploadChecklist(auth, employee.driveFolderId, checklist);
    saveState(employee.employeeId, { checklist, milestonesScheduled: employee.milestonesScheduled || false });
  }

  // After meeting screenshot → confirm phase 3 DOJ tasks
  if (docType === 'meetingScreenshot') {
    markTask(checklist, 't34');
    markTask(checklist, 't37');
    markTask(checklist, 't42');
    await uploadChecklist(auth, employee.driveFolderId, checklist);

    // Schedule all timed milestones if not already done
    if (!employee.milestonesScheduled) {
      // Pass markTask wrapper so cron callbacks can update the checklist
      const markTaskForEmployee = (taskId) => markTask(checklist, taskId);
      scheduleAllMilestones(employee, contacts, markTaskForEmployee);
      employee.milestonesScheduled = true;
      markTask(checklist, 't38');
      markTask(checklist, 't39');
      markTask(checklist, 't41');
      await uploadChecklist(auth, employee.driveFolderId, checklist);
      await markOnboardingComplete(auth, employee).catch(() => {});
      saveState(employee.employeeId, { checklist, milestonesScheduled: true });
    }

    // t40: Send catchup XLS tracker email to recruiter + manager
    if (!isTaskDone(checklist, 't40')) {
      await sendCatchupXLSEmail(employee);
      markTask(checklist, 't40');
      await uploadChecklist(auth, employee.driveFolderId, checklist);
      saveState(employee.employeeId, { checklist, milestonesScheduled: employee.milestonesScheduled || true });
    }

    // t35/t36: IT and Admin haven't confirmed yet — schedule 48h escalation timers
    employee.replyTimers = employee.replyTimers || {};
    if (!isTaskDone(checklist, 't35')) {
      employee.replyTimers.itDoj = scheduleReplyDeadline(
        employee, 'IT Team (DOJ Assets)', contacts.itEmail
      );
    }
    if (!isTaskDone(checklist, 't36')) {
      employee.replyTimers.admin = scheduleReplyDeadline(
        employee, 'Admin (Seat Allocation)', process.env.HR_EMAIL
      );
    }

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

  switch (replyType) {
    case 'official_email_created':
      if (data.officialEmail) {
        employee.officialEmail = data.officialEmail;
        markTask(checklist, 't15');
        markTask(checklist, 't16');
        console.log(`[Index] Official email recorded: ${data.officialEmail}`);
        await markOfficialEmailConfirmed(auth, employee, data.officialEmail).catch(() => {});
        // Cancel 48h HR reply-deadline timer
        if (employee.replyTimers && employee.replyTimers.hr) {
          employee.replyTimers.hr.stop && employee.replyTimers.hr.stop();
          delete employee.replyTimers.hr;
        }
      }
      break;

    case 'manager_allocation':
      if (data.assetType || data.officeLocation || data.supervisorName) {
        employee.assetDetails = data;
        markTask(checklist, 't18');
        markTask(checklist, 't19');
        await markManagerConfirmed(auth, employee, data).catch(() => {});
        await sendITAssetRequest(employee, employee.contacts.itEmail, data);
        markTask(checklist, 't20');
        // Cancel 48h manager reply-deadline timer
        if (employee.replyTimers && employee.replyTimers.manager) {
          employee.replyTimers.manager.stop && employee.replyTimers.manager.stop();
          delete employee.replyTimers.manager;
        }
      }
      break;

    case 'it_allocation':
      markTask(checklist, 't21');
      markTask(checklist, 't22');
      markTask(checklist, 't35');
      await markITConfirmed(auth, employee).catch(() => {});
      // Cancel 48h IT reply-deadline timers
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
      markTask(checklist, 't25');
      markTask(checklist, 't26');
      await markBGVDone(auth, employee).catch(() => {});
      // Cancel 48h BGV/recruiter reply-deadline timer
      if (employee.replyTimers && employee.replyTimers.bgv) {
        employee.replyTimers.bgv.stop && employee.replyTimers.bgv.stop();
        delete employee.replyTimers.bgv;
      }
      break;

    case 'induction_confirmed':
      markTask(checklist, 't33');
      markTask(checklist, 't34');
      // Cancel any induction reply timer if one exists
      if (employee.replyTimers && employee.replyTimers.induction) {
        employee.replyTimers.induction.stop && employee.replyTimers.induction.stop();
        delete employee.replyTimers.induction;
      }
      break;

    case 'admin_allocation':
      // t36: Admin confirms seat allocation
      markTask(checklist, 't36');
      // Cancel 48h admin reply-deadline timer
      if (employee.replyTimers && employee.replyTimers.admin) {
        employee.replyTimers.admin.stop && employee.replyTimers.admin.stop();
        delete employee.replyTimers.admin;
      }
      break;

    case 'catchup_complete':
      markTask(checklist, 't43');
      markTask(checklist, 't44');
      markTask(checklist, 't45');
      await mark30DayDone(auth, employee).catch(() => {});
      break;

    case 'review_complete': {
      // Determine which review based on days since DOJ
      const daysSinceDoj = Math.floor(
        (Date.now() - new Date(employee.doj).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceDoj < 75) {
        markTask(checklist, 't46'); markTask(checklist, 't48');
        await mark60DayDone(auth, employee).catch(() => {});
      } else if (daysSinceDoj < 120) {
        markTask(checklist, 't49'); markTask(checklist, 't51');
        await mark90DayDone(auth, employee).catch(() => {});
      }
      break;
    }

    default:
      console.log(`[Index] Unhandled reply type: ${replyType}`);
      return;
  }

  await uploadChecklist(auth, employee.driveFolderId, checklist);
  saveState(employee.employeeId, { checklist, milestonesScheduled: employee.milestonesScheduled || false });
}

// ─── Employee registry (shared with webhookServer) ────────────────────────────
const employeeRegistry = {};

// ─── Bootstrap an employee when they are first added ──────────────────────────
async function onboardEmployee(auth, employee) {
  // Register in shared registry so webhookServer can look them up
  employeeRegistry[employee.employeeId] = employee;
  // Store auth on employee so cron callbacks can call statusTracker
  employee._auth = auth;

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
    const markTaskForEmployee = (taskId) => markTask(employee.checklist, taskId);
    restoreMilestonesAfterRestart(employee, employee.contacts, completedTasks, markTaskForEmployee);
  }

  const alreadyStarted = isTaskDone(employee.checklist, 't4');

  if (!alreadyStarted) {
    console.log(`\n[Index] Starting onboarding for ${employee.name} (${employee.employeeId})`);

    // Step 1: Scaffold Drive folder structure
    await scaffoldEmployeeFolder(auth, employee.driveFolderId, employee.name, employee.employeeId);
    markTask(employee.checklist, 't6');
    markTask(employee.checklist, 't7');
    markTask(employee.checklist, 't8');

    // Step 2: Create status sheet and mark preonboarding initiated
    await getOrCreateStatusSheet(auth, employee).catch(() => {});
    await markPreonboardingInitiated(auth, employee).catch(() => {});

    // Step 3: Send pre-onboarding form
    await sendPreOnboardingForm(employee);
    markTask(employee.checklist, 't4');

    // Step 5: Save checklist to Drive and locally
    await uploadChecklist(auth, employee.driveFolderId, employee.checklist);
    saveState(employee.employeeId, { checklist: employee.checklist, milestonesScheduled: employee.milestonesScheduled || false });

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

  const auth = getAuthClient();

  // Start webhook server (must come before onboarding so registry is available)
  webhookServer.init({
    auth,
    employeeRegistry,
    handleNewFile: (a, emp, file) => handleNewFile(a, emp, file),
    handleReply: (classified, rawMsg) => handleReply(auth, classified, rawMsg),
    onNewEmployee: async (data) => {
      const savedState = loadState();
      const saved = savedState[data.employeeId];
      const employee = {
        ...data,
        checklist: saved ? saved.checklist : buildDefaultChecklist(),
        milestonesScheduled: saved ? (saved.milestonesScheduled || false) : false,
        noResponseTimers: {},
        replyTimers: {},
        verificationResults: {},
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
      if (!employee.checklist) employee.checklist = buildDefaultChecklist();
      if (!employee.noResponseTimers) employee.noResponseTimers = {};
      if (!employee.replyTimers) employee.replyTimers = {};
      if (!employee.verificationResults) employee.verificationResults = {};
      await onboardEmployee(auth, employee);
    }
  }

  // Start daily health-check cron
  startDailyHealthCheck();

  console.log('[Index] Engine running. Press Ctrl+C to stop.\n');
}

main().catch(err => {
  console.error('[Index] Fatal error:', err.message);
  process.exit(1);
});
