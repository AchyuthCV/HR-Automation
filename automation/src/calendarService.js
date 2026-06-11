// Google Calendar integration — creates onboarding milestone events for employees
// All times are in IST (Asia/Kolkata, UTC+05:30)

const { google } = require('googleapis');

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
  return {
    dateTime: `${y}-${mo}-${d}T${h}:${mi}:00+05:30`,
    timeZone: 'Asia/Kolkata',
  };
}

// ─── Exported calendar functions ───────────────────────────────────────────────

/**
 * Create HR Induction event on the employee's DOJ at 9:30–11:00 AM IST.
 * Returns the event htmlLink, or null on failure.
 */
async function createHRInductionEvent(auth, employee) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dojDate = new Date(employee.doj);

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.recruiterEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const event = {
      summary: `HR Induction — ${employee.name}`,
      description: `HR Induction session for ${employee.name} (${employee.employeeId}). Covers company policies, tools, culture, and greythr walkthrough.`,
      location: 'Office / As communicated by HR',
      start: toGoogleDateTime(dojDate, 9, 30),
      end: toGoogleDateTime(dojDate, 11, 0),
      attendees,
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
 * Create Project Intro Meeting event 3 working days after DOJ at 2:00–3:00 PM IST.
 * Returns the event htmlLink, or null on failure.
 */
async function createProjectIntroEvent(auth, employee) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dojDate = new Date(employee.doj);
    const eventDate = ensureWorkingDay(addDays(dojDate, 3));

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.managerEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const event = {
      summary: `Project Intro Meeting — ${employee.name}`,
      description: `Project introduction meeting for ${employee.name} with their reporting manager. Agenda: role overview, key projects, initial goals, buddy introduction.`,
      start: toGoogleDateTime(eventDate, 14, 0),
      end: toGoogleDateTime(eventDate, 15, 0),
      attendees,
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
    const eventDate = ensureWorkingDay(addDays(dojDate, 30));

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.recruiterEmail,
      employee.contacts && employee.contacts.managerEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const event = {
      summary: `30-Day Catchup — ${employee.name}`,
      description: `30-day catchup call for ${employee.name} (${employee.employeeId}). Covers onboarding experience, role clarity, challenges, and initial performance feedback.`,
      start: toGoogleDateTime(eventDate, 11, 0),
      end: toGoogleDateTime(eventDate, 11, 30),
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
    const eventDate = ensureWorkingDay(addDays(dojDate, dayMark));

    const attendees = [
      employee.officialEmail || employee.personalEmail,
      employee.contacts && employee.contacts.recruiterEmail,
      employee.contacts && employee.contacts.managerEmail,
    ]
      .filter(Boolean)
      .map(email => ({ email }));

    const event = {
      summary: `${dayMark}-Day Review — ${employee.name}`,
      description: `${dayMark}-day performance review for ${employee.name} (${employee.employeeId}). Covers performance assessment, key achievements, areas of improvement, and next goals.`,
      start: toGoogleDateTime(eventDate, 15, 0),
      end: toGoogleDateTime(eventDate, 16, 0),
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
