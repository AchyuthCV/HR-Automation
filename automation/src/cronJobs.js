const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { create30DayCatchupEvent, createReviewEvent } = require('./calendarService');
const {
  sendPeriodicReviewReminder,
  sendPreProbationReminder,
  sendPhaseCompletionSummary,
  sendReviewSummaryRequest,
  sendNoReplyEscalation,
} = require('./emailSender');
const {
  mark30DayDone,
  mark60DayDone,
  mark90DayDone,
  markPreprobationDone,
} = require('./statusTracker');
function isTaskDone(checklist, taskId) {
  if (!checklist) return false;
  for (const phase of Object.values(checklist)) {
    if (phase.tasks && phase.tasks[taskId]) return phase.tasks[taskId].done;
  }
  return false;
}

// In-memory store of scheduled jobs, keyed by employeeId
// Structure: { [employeeId]: { tasks: cron.ScheduledTask[], employee: {}, milestones: {} } }
const activeJobs = {};

// Return a Date that is `days` calendar days after the given Date
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Advance to next Monday if the date falls on a weekend
function ensureWorkingDay(date) {
  const d = new Date(date);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Saturday → Monday
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sunday  → Monday
  return d;
}

// Convert a Date to a node-cron expression "minute hour day month *"
function dateToCron(date) {
  return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
}

// Schedule a one-shot cron that fires once on targetDate then destroys itself
function scheduleOnce(targetDate, label, fn) {
  const now = new Date();
  if (targetDate <= now) {
    console.log(`[Cron] "${label}" target is in the past — running immediately`);
    fn().catch(err => console.error(`[Cron] "${label}" error:`, err.message));
    return null;
  }

  const expression = dateToCron(targetDate);
  console.log(`[Cron] Scheduled "${label}" → ${targetDate.toDateString()} (${expression})`);

  const task = cron.schedule(expression, async () => {
    console.log(`[Cron] Firing "${label}"`);
    try {
      await fn();
    } catch (err) {
      console.error(`[Cron] "${label}" error:`, err.message);
    }
    task.stop();
  });
  return task;
}

// Schedule the onboarding survey to be sent on day 25 (working day)
function scheduleOnboardingSurvey(employee) {
  const { name, employeeId, officialEmail, doj } = employee;
  const dojDate = new Date(doj);
  const surveyDate = ensureWorkingDay(addDays(dojDate, config.milestones.surveyday));

  return scheduleOnce(surveyDate, `Onboarding Survey — ${name}`, async () => {
    const { sendEmail } = require('./emailSender');
    // Survey form link can be customised; using a placeholder for now
    const surveyLink = process.env.ONBOARDING_SURVEY_LINK || '#survey-link';
    await sendEmail({
      to: officialEmail || employee.personalEmail,
      subject: `Your Onboarding Survey — ${process.env.COMPANY_NAME}`,
      html: `
        <p>Dear ${name},</p>
        <p>You've been with us for 25 days! We'd love to hear about your onboarding experience.</p>
        <p>Please take 5 minutes to complete this survey:</p>
        <p><a href="${surveyLink}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;">Complete Onboarding Survey</a></p>
        <p>Your feedback helps us improve the experience for future joiners.</p>
        <p>Regards,<br/>HR Team, ${process.env.COMPANY_NAME}</p>
      `,
    });
    console.log(`[Cron] Onboarding survey sent to ${name} (${employeeId})`);
  });
}

// Schedule the 30-day catchup call reminder
// contacts: { recruiterEmail, managerEmail, itEmail }
// markTaskFn (optional): function(taskId) to mark checklist tasks from within the callback
function schedule30DayCatchup(employee, recruiterEmail, managerEmail, contacts, markTaskFn) {
  const { name, employeeId, doj } = employee;
  const fireDate = ensureWorkingDay(addDays(new Date(doj), config.milestones.catchup30day));

  return scheduleOnce(fireDate, `30-Day Catchup — ${name}`, async () => {
    if (employee._auth) await create30DayCatchupEvent(employee._auth, employee).catch(err =>
      console.warn(`[Cron] 30-day calendar event failed for ${name} — email still sent. (${err.message})`)
    );

    // t43: send review summary request to recruiter + manager asking them to confirm catchup
    await sendReviewSummaryRequest(employee, 30);
    console.log(`[Cron] 30-day review summary request sent for ${name} (${employeeId})`);
    if (markTaskFn) markTaskFn('t43');

    if (employee._auth) await mark30DayDone(employee._auth, employee).catch(() => {});

    // Schedule 48h no-reply escalation for the 30-day review and persist the timer handle
    employee.replyTimers = employee.replyTimers || {};
    employee.replyTimers['30dayReview'] = scheduleReplyDeadline(
      employee, 'Recruiter / Manager (30-Day Review)', recruiterEmail, 48
    );
    if (employee._saveState) employee._saveState();
  });
}

// Schedule 60-day review reminder
// contacts: { recruiterEmail, managerEmail, itEmail }
function schedule60DayReview(employee, recruiterEmail, managerEmail, contacts, markTaskFn) {
  const { name, employeeId, doj } = employee;
  const fireDate = ensureWorkingDay(addDays(new Date(doj), config.milestones.review60day));

  return scheduleOnce(fireDate, `60-Day Review — ${name}`, async () => {
    await sendPeriodicReviewReminder(employee, recruiterEmail, managerEmail, 60);
    console.log(`[Cron] 60-day review reminder sent for ${name} (${employeeId})`);
    if (employee._auth) await createReviewEvent(employee._auth, employee, 60).catch(err =>
      console.warn(`[Cron] 60-day calendar event failed for ${name} — email still sent. (${err.message})`)
    );

    // t46: send review summary request (replaces "call transcribed")
    await sendReviewSummaryRequest(employee, 60);
    console.log(`[Cron] 60-day review summary request sent for ${name} (${employeeId})`);
    if (markTaskFn) markTaskFn('t46');

    if (employee._auth) await mark60DayDone(employee._auth, employee).catch(() => {});

    // t47: escalate and mark if review_complete reply hasn't arrived within 48h
    // Use scheduleReplyDeadline so the timer is persisted in replyTimers + survives restart
    employee.replyTimers = employee.replyTimers || {};
    employee.replyTimers['60dayNoReply'] = scheduleReplyDeadline(
      employee, 'Recruiter / Manager (60-Day Review)', recruiterEmail, 48
    );
    if (employee._saveState) employee._saveState();
    // Also mark t47 when the 48h window expires (best-effort, same fire time)
    scheduleOnce(new Date(Date.now() + 48 * 60 * 60 * 1000), `60-Day No-Reply Mark — ${name}`, async () => {
      if (!isTaskDone(employee.checklist, 't48')) {
        if (markTaskFn) markTaskFn('t47');
        console.log(`[Cron] 60-day no-reply: t47 marked for ${name}`);
      }
    });
  });
}

// Schedule 90-day review reminder
// contacts: { recruiterEmail, managerEmail, itEmail }
function schedule90DayReview(employee, recruiterEmail, managerEmail, contacts, markTaskFn) {
  const { name, employeeId, doj } = employee;
  const fireDate = ensureWorkingDay(addDays(new Date(doj), config.milestones.review90day));

  return scheduleOnce(fireDate, `90-Day Review — ${name}`, async () => {
    await sendPeriodicReviewReminder(employee, recruiterEmail, managerEmail, 90);
    console.log(`[Cron] 90-day review reminder sent for ${name} (${employeeId})`);
    if (employee._auth) await createReviewEvent(employee._auth, employee, 90).catch(err =>
      console.warn(`[Cron] 90-day calendar event failed for ${name} — email still sent. (${err.message})`)
    );

    // t49: send review summary request (replaces "call transcribed")
    await sendReviewSummaryRequest(employee, 90);
    console.log(`[Cron] 90-day review summary request sent for ${name} (${employeeId})`);
    if (markTaskFn) markTaskFn('t49');

    if (employee._auth) await mark90DayDone(employee._auth, employee).catch(() => {});

    // t50: escalate and mark if review_complete reply hasn't arrived within 48h
    // Use scheduleReplyDeadline so the timer is persisted in replyTimers + survives restart
    employee.replyTimers = employee.replyTimers || {};
    employee.replyTimers['90dayNoReply'] = scheduleReplyDeadline(
      employee, 'Recruiter / Manager (90-Day Review)', recruiterEmail, 48
    );
    if (employee._saveState) employee._saveState();
    // Also mark t50 when the 48h window expires (best-effort, same fire time)
    scheduleOnce(new Date(Date.now() + 48 * 60 * 60 * 1000), `90-Day No-Reply Mark — ${name}`, async () => {
      if (!isTaskDone(employee.checklist, 't51')) {
        if (markTaskFn) markTaskFn('t50');
        console.log(`[Cron] 90-day no-reply: t50 marked for ${name}`);
      }
    });
  });
}

// Schedule 5-month pre-probation reminder (approx 150 days)
function schedule5MonthProbation(employee, managerEmail) {
  const { name, employeeId, doj } = employee;
  const fireDate = ensureWorkingDay(addDays(new Date(doj), config.milestones.probation150day));

  return scheduleOnce(fireDate, `Pre-Probation — ${name}`, async () => {
    await sendPreProbationReminder(employee, managerEmail);
    console.log(`[Cron] Pre-probation reminder sent for ${name} (${employeeId})`);
    if (employee._markTask) {
      employee._markTask('t52');
      employee._markTask('t55');
    }
    if (employee._auth) await markPreprobationDone(employee._auth, employee).catch(() => {});
  });
}

// Schedule a no-response follow-up 24 hours after a document request
function scheduleNoResponseAlert(employee, recruiterEmail, delayHours) {
  const hours = delayHours || config.replyDeadlines.noResponseAlertHours;
  const fireDate = new Date(Date.now() + hours * 60 * 60 * 1000);
  const { name, employeeId } = employee;

  return scheduleOnce(fireDate, `No-Response Alert — ${name}`, async () => {
    const { sendNoResponseAlert } = require('./emailSender');
    await sendNoResponseAlert(employee, recruiterEmail);
    console.log(`[Cron] No-response alert sent to recruiter for ${name} (${employeeId})`);
    // t11: alert sent to recruiter because employee didn't respond > 24h
    if (employee._markTask) employee._markTask('t11');
  });
}

// Schedule a 48h reply-deadline escalation for any stakeholder who hasn't replied
// Returns a task handle with .stop() — same pattern as scheduleNoResponseAlert
function scheduleReplyDeadline(employee, recipientType, recipientEmail, delayHours) {
  const hours = delayHours || config.replyDeadlines.stakeholderReplyHours;
  const fireDate = new Date(Date.now() + hours * 60 * 60 * 1000);
  const { name, employeeId } = employee;

  const task = scheduleOnce(fireDate, `Reply Deadline — ${recipientType} — ${name}`, async () => {
    await sendNoReplyEscalation(employee, recipientType, recipientEmail);
    console.log(`[Cron] No-reply escalation sent to HR for ${recipientType} re: ${name} (${employeeId})`);
  });
  // Stamp expiry and recipient so the state snapshot can restore with the correct escalation target
  if (task) {
    task._expiresAt = fireDate.toISOString();
    task._recipientEmail = recipientEmail;
  }
  return task;
}

// Register ALL milestones for a new employee and store their job handles
// markTaskFn (optional): function(taskId) — called from inside cron callbacks to update checklist
function scheduleAllMilestones(employee, contacts, markTaskFn) {
  const { employeeId } = employee;
  const { recruiterEmail, managerEmail, itEmail } = contacts;

  const tasks = [
    scheduleOnboardingSurvey(employee),
    schedule30DayCatchup(employee, recruiterEmail, managerEmail, contacts, markTaskFn),
    schedule60DayReview(employee, recruiterEmail, managerEmail, contacts, markTaskFn),
    schedule90DayReview(employee, recruiterEmail, managerEmail, contacts, markTaskFn),
    schedule5MonthProbation(employee, managerEmail),
  ].filter(Boolean);

  activeJobs[employeeId] = { tasks, employee, contacts };
  console.log(`[Cron] All milestones scheduled for ${employee.name} (${employeeId})`);
  return tasks;
}

// Re-register milestone cron jobs after a process restart
// Only re-registers jobs whose corresponding tasks are not yet done.
// completedMilestones: array of completed task IDs e.g. ['t38', 't45']
// Task → milestone map: survey→t38, 30day→t45, 60day→t48, 90day→t51, probation→t52
function restoreMilestonesAfterRestart(employee, contacts, completedMilestones, markTaskFn) {
  if (!contacts) {
    console.warn(`[Cron] restoreMilestonesAfterRestart: no contacts for ${employee.name} — skipping`);
    return;
  }

  const dojDate = new Date(employee.doj);
  if (!employee.doj || isNaN(dojDate.getTime())) {
    console.warn(`[Cron] restoreMilestonesAfterRestart: invalid or missing DOJ for ${employee.name} — skipping`);
    return;
  }

  const done = new Set(completedMilestones || []);
  const { employeeId, name } = employee;
  const { recruiterEmail, managerEmail } = contacts;

  console.log(`[Cron] Restoring milestones after restart for ${name} (${employeeId})`);

  const tasks = [];

  if (!done.has('t38')) {
    const t = scheduleOnboardingSurvey(employee);
    if (t) tasks.push(t);
  } else {
    console.log(`[Cron]   Skipping onboarding survey (t38 already done)`);
  }

  if (!done.has('t45')) {
    const t = schedule30DayCatchup(employee, recruiterEmail, managerEmail, contacts, markTaskFn);
    if (t) tasks.push(t);
  } else {
    console.log(`[Cron]   Skipping 30-day catchup (t45 already done)`);
  }

  if (!done.has('t48')) {
    const t = schedule60DayReview(employee, recruiterEmail, managerEmail, contacts, markTaskFn);
    if (t) tasks.push(t);
  } else {
    console.log(`[Cron]   Skipping 60-day review (t48 already done)`);
  }

  if (!done.has('t51')) {
    const t = schedule90DayReview(employee, recruiterEmail, managerEmail, contacts, markTaskFn);
    if (t) tasks.push(t);
  } else {
    console.log(`[Cron]   Skipping 90-day review (t51 already done)`);
  }

  if (!done.has('t52')) {
    const t = schedule5MonthProbation(employee, managerEmail);
    if (t) tasks.push(t);
  } else {
    console.log(`[Cron]   Skipping pre-probation (t52 already done)`);
  }

  // Merge with any existing job store entry
  if (!activeJobs[employeeId]) {
    activeJobs[employeeId] = { tasks: [], employee, contacts };
  }
  activeJobs[employeeId].tasks.push(...tasks);

  console.log(`[Cron] Restored ${tasks.length} milestone job(s) for ${name} (${employeeId})`);
}

// Cancel all cron jobs for an employee (e.g. if they leave)
function cancelAllJobs(employeeId) {
  const entry = activeJobs[employeeId];
  if (!entry) return;
  entry.tasks.forEach(t => t && t.stop());
  delete activeJobs[employeeId];
  console.log(`[Cron] All jobs cancelled for ${employeeId}`);
}

// Daily health-check cron — runs at 9 AM every day, logs active jobs
function startDailyHealthCheck() {
  cron.schedule(config.healthCheckCron, () => {
    const count = Object.keys(activeJobs).length;
    console.log(`[Cron] Daily health check — ${count} employee(s) with active scheduled jobs`);
    Object.entries(activeJobs).forEach(([id, entry]) => {
      console.log(`  → ${entry.employee.name} (${id}) | DOJ: ${entry.employee.doj}`);
    });
  });
  console.log('[Cron] Daily health-check scheduled at 9 AM on weekdays');
}

// Data retention cron — runs at 2 AM daily, purges logs older than RETENTION_DAYS
function startDataRetentionCron() {
  const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '90', 10);
  if (isNaN(retentionDays) || retentionDays < 1) return;

  // Run at 2:00 AM every day
  cron.schedule('0 2 * * *', () => {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const logsDir = path.join(__dirname, '..', 'logs');
    const auditDir = path.join(logsDir, 'audit');

    let purged = 0;
    for (const dir of [logsDir, auditDir]) {
      if (!fs.existsSync(dir)) continue;
      try {
        for (const file of fs.readdirSync(dir)) {
          const full = path.join(dir, file);
          try {
            const stat = fs.statSync(full);
            if (stat.isFile() && stat.mtimeMs < cutoff) {
              fs.unlinkSync(full);
              purged++;
            }
          } catch { /* skip locked or vanished files */ }
        }
      } catch { /* skip unreadable dir */ }
    }

    if (purged > 0) {
      console.log(`[Cron] Data retention: purged ${purged} log file(s) older than ${retentionDays} days`);
    }
  });
  console.log(`[Cron] Data retention cron scheduled (purge logs older than ${retentionDays} days at 2 AM daily)`);
}

module.exports = {
  scheduleAllMilestones,
  scheduleNoResponseAlert,
  scheduleReplyDeadline,
  restoreMilestonesAfterRestart,
  scheduleOnboardingSurvey,
  schedule30DayCatchup,
  schedule60DayReview,
  schedule90DayReview,
  schedule5MonthProbation,
  cancelAllJobs,
  startDailyHealthCheck,
  startDataRetentionCron,
};
