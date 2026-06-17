// Google Calendar integration — creates onboarding milestone events for employees
// All times are in IST (Asia/Kolkata, UTC+05:30)

const { google } = require('googleapis');
const config = require('./config');

// ─── Internal helpers ──────────────────────────────────────────────────────────

// Add N calendar days to a date
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Advance to next Monday if date falls on a weekend
function ensureWorkingDay(date) {
  const d = new Date(date);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Saturday → Monday
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sunday  → Monday
  return d;
}

// Returns { dateTime, timeZone } for Google Calendar API in IST
function toGoogleDateTime(date, hour, minute) {
  // Build an ISO string with the IST offset +05:30
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  const tzOffset = config.timezone === 'Asia/Kolkata' ? '+05:30' : '+00:00';
  return {
    dateTime: `${y}-${mo}-${d}T${h}:${mi}:00${tzOffset}`,
    timeZone: config.timezone,
  };
}

// ─── Exported calendar functions ───────────────────────────────────────────────

/**
 * Create HR Induction event on the employee's DOJ at 9:30–11:00 AM IST.
 * DOJ is always a working day but we guard against weekends just in case.
 * Attendees: employee + recruiter + manager — all receive a calendar invite
 * with accept/decline/reschedule options (sendUpdates: 'all').
 * Returns the event htmlLink, or null on failure.
 */
async function createHRInductionEvent(auth, employee) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dojDate = new Date(employee.doj);
    if (!employee.doj || isNaN(dojDate.getTime())) {
      console.error(`[Calendar] createHRInductionEvent: invalid DOJ "${employee.doj}" for ${employee.name}`);
      return null;
    }

    // Guard: DOJ must be a working day — push to Monday if it lands on a weekend
    const inductionDate = ensureWorkingDay(dojDate);

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.recruiterEmail,
      employee.contacts && employee.contacts.managerEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const cfg = config.calendarEvents.hrInduction;
    const endMins = cfg.minute + cfg.durationMins;
    const event = {
      summary: `HR Induction — ${employee.name}`,
      description: `HR Induction session for ${employee.name} (${employee.employeeId}).\n\nAgenda:\n• Company policies and culture\n• Tools and systems walkthrough\n• Greythr login setup\n• Team introductions\n\nConducted by: Recruiter / HR Team\n\nNote: You can propose a new time using the calendar invite if this slot does not work.`,
      location: 'Office / As communicated by HR',
      start: toGoogleDateTime(inductionDate, cfg.hour, cfg.minute),
      end: toGoogleDateTime(inductionDate, cfg.hour + Math.floor(endMins / 60), endMins % 60),
      attendees,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: true,
    };

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all',
    });

    console.log(`[Calendar] HR Induction event created for ${employee.name}: ${res.data.htmlLink}`);
    return res.data.htmlLink;
  } catch (err) {
    console.error('[Calendar] error: createHRInductionEvent failed:', err.message);
    return null;
  }
}

/**
 * Create Project Intro Meeting event on DOJ itself (post-lunch) at 2:00–3:00 PM IST.
 * Spec: "Automation schedules project intro meeting with new joinee on the DOJ
 * with reporting manager as per availability on managers' calendar post lunch."
 * DOJ is always a working day — weekend guard applied just in case.
 * Attendees: employee + manager + recruiter — all get invite with reschedule option.
 * Returns the event htmlLink, or null on failure.
 */
async function createProjectIntroEvent(auth, employee) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dojDate = new Date(employee.doj);
    if (!employee.doj || isNaN(dojDate.getTime())) {
      console.error(`[Calendar] createProjectIntroEvent: invalid DOJ "${employee.doj}" for ${employee.name}`);
      return null;
    }

    // Meeting is on DOJ itself (post-lunch) — guard for weekend just in case
    const eventDate = ensureWorkingDay(dojDate);

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.managerEmail,
      employee.contacts && employee.contacts.recruiterEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const cfg = config.calendarEvents.projectIntro;
    const endMins = cfg.minute + cfg.durationMins;
    const event = {
      summary: `Project Intro Meeting — ${employee.name}`,
      description: `Project introduction meeting for ${employee.name} (${employee.employeeId}) with their reporting manager.\n\nAgenda:\n• Role overview and expectations\n• Key projects and initial goals\n• Team and buddy introduction\n• Q&A\n\nNote: If this post-lunch slot does not work, you can propose a new time using the calendar invite.`,
      start: toGoogleDateTime(eventDate, cfg.hour, cfg.minute),
      end: toGoogleDateTime(eventDate, cfg.hour + Math.floor(endMins / 60), endMins % 60),
      attendees,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: true,
    };

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all',
    });

    console.log(`[Calendar] Project Intro event created for ${employee.name}: ${res.data.htmlLink}`);
    return res.data.htmlLink;
  } catch (err) {
    console.error('[Calendar] error: createProjectIntroEvent failed:', err.message);
    return null;
  }
}

/**
 * Create 30-Day Catchup event on working day 30 at 11:00–11:30 AM IST.
 * Returns the event htmlLink, or null on failure.
 */
async function create30DayCatchupEvent(auth, employee) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dojDate = new Date(employee.doj);
    if (!employee.doj || isNaN(dojDate.getTime())) {
      console.error(`[Calendar] create30DayCatchupEvent: invalid DOJ "${employee.doj}" for ${employee.name}`);
      return null;
    }
    const eventDate = ensureWorkingDay(addDays(dojDate, config.milestones.catchup30day));

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.recruiterEmail,
      employee.contacts && employee.contacts.managerEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const cfg = config.calendarEvents.catchup30day;
    const endMins = cfg.minute + cfg.durationMins;
    const event = {
      summary: `30-Day Catchup — ${employee.name}`,
      description: `30-day catchup call for ${employee.name} (${employee.employeeId}). Covers onboarding experience, role clarity, challenges, and initial performance feedback.`,
      start: toGoogleDateTime(eventDate, cfg.hour, cfg.minute),
      end: toGoogleDateTime(eventDate, cfg.hour + Math.floor(endMins / 60), endMins % 60),
      attendees,
    };

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all',
    });

    console.log(`[Calendar] 30-Day Catchup event created for ${employee.name}: ${res.data.htmlLink}`);
    return res.data.htmlLink;
  } catch (err) {
    console.error('[Calendar] error: create30DayCatchupEvent failed:', err.message);
    return null;
  }
}

/**
 * Create a 60-day or 90-day review event at 3:00–4:00 PM IST.
 * dayMark: 60 or 90
 * Returns the event htmlLink, or null on failure.
 */
async function createReviewEvent(auth, employee, dayMark) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dojDate = new Date(employee.doj);
    if (!employee.doj || isNaN(dojDate.getTime())) {
      console.error(`[Calendar] createReviewEvent (${dayMark}-day): invalid DOJ "${employee.doj}" for ${employee.name}`);
      return null;
    }
    const eventDate = ensureWorkingDay(addDays(dojDate, dayMark));

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.recruiterEmail,
      employee.contacts && employee.contacts.managerEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const cfg = config.calendarEvents.reviewMeeting;
    const endMins = cfg.minute + cfg.durationMins;
    const event = {
      summary: `${dayMark}-Day Review — ${employee.name}`,
      description: `${dayMark}-day performance review for ${employee.name} (${employee.employeeId}). Covers performance assessment, key achievements, areas of improvement, and next goals.`,
      start: toGoogleDateTime(eventDate, cfg.hour, cfg.minute),
      end: toGoogleDateTime(eventDate, cfg.hour + Math.floor(endMins / 60), endMins % 60),
      attendees,
    };

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all',
    });

    console.log(`[Calendar] ${dayMark}-Day Review event created for ${employee.name}: ${res.data.htmlLink}`);
    return res.data.htmlLink;
  } catch (err) {
    console.error(`[Calendar] error: createReviewEvent (${dayMark}-day) failed:`, err.message);
    return null;
  }
}

module.exports = {
  createHRInductionEvent,
  createProjectIntroEvent,
  create30DayCatchupEvent,
  createReviewEvent,
};
