// statusTracker.js — live Google Sheet dashboard per employee
//
// One sheet per employee, created inside their Drive folder.
// 15 milestone rows, 4 columns: Milestone | Status | Last Updated | Notes
//
// Milestones map to exact onboarding phases:
//  Row 1:  Pre-onboarding initiated
//  Row 2:  Documents received
//  Row 3:  Document issue — re-upload requested
//  Row 4:  Documents verified OK
//  Row 5:  Official email & greythr login confirmed
//  Row 6:  Manager confirmed seat and work location
//  Row 7:  IT team confirmed assets
//  Row 8:  BGV initiated and completed
//  Row 9:  HR induction scheduled
//  Row 10: Project intro meeting scheduled
//  Row 11: Day of Joining — onboarding complete
//  Row 12: 30-day catchup completed
//  Row 13: 60-day review completed
//  Row 14: 90-day review completed
//  Row 15: Pre-probation verification completed

const { google } = require('googleapis');
require('dotenv').config();

const STATUS = {
  PENDING:     '⏳ Pending',
  IN_PROGRESS: '🔄 In Progress',
  DONE:        '✅ Done',
  ACTION_REQ:  '⚠️ Action Required',
  NOT_OK:      '❌ Not OK',
};

const MILESTONES = [
  'Pre-onboarding initiated',
  'Documents received',
  'Document issue — re-upload requested',
  'Documents verified OK',
  'Official email & greythr login confirmed',
  'Manager confirmed seat and work location',
  'IT team confirmed assets',
  'BGV initiated and completed',
  'HR induction scheduled',
  'Project intro meeting scheduled',
  'Day of Joining — onboarding complete',
  '30-day catchup completed',
  '60-day review completed',
  '90-day review completed',
  'Pre-probation verification completed',
];

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ─── Get or create the status sheet for an employee ──────────────────────────
async function getOrCreateStatusSheet(auth, employee) {
  if (employee.statusSheetId) return employee.statusSheetId;

  const drive  = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // Check if sheet already exists in employee's Drive folder
  const existing = await drive.files.list({
    q: `name='Onboarding_Status_${employee.employeeId}' and '${employee.driveFolderId}' in parents and trashed=false`,
    fields: 'files(id)',
  });

  if (existing.data.files.length > 0) {
    employee.statusSheetId = existing.data.files[0].id;
    console.log(`[Status] Found existing status sheet for ${employee.name}`);
    return employee.statusSheetId;
  }

  // Create new spreadsheet
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Onboarding Status — ${employee.name} (${employee.employeeId})` },
      sheets: [{ properties: { title: 'Status' } }],
    },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId;
  const sheetId = spreadsheet.data.sheets[0].properties.sheetId;

  // Move it into the employee's Drive folder
  await drive.files.update({
    fileId: spreadsheetId,
    addParents: employee.driveFolderId,
    fields: 'id, parents',
  });

  // Write header + all 15 milestones + progress bar row at top
  const now = nowIST();
  // Row 1: progress bar  Row 2: column headers  Rows 3-17: milestones
  const rows = [
    ['Onboarding Progress', '=COUNTIF(B3:B17,"✅ Done")/15', '', '=TEXT(COUNTIF(B3:B17,"✅ Done")/15,"0%")&" Complete ("&COUNTIF(B3:B17,"✅ Done")&"/15)"],
    ['Milestone', 'Status', 'Last Updated', 'Notes'],
    ...MILESTONES.map((m, i) => [
      m,
      i === 0 ? STATUS.IN_PROGRESS : STATUS.PENDING,
      i === 0 ? now : '',
      '',
    ]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Status!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  // Format the sheet
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Progress bar row (row 1) — green background
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.13, green: 0.55, blue: 0.13 },
                textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          },
        },
        // Header row (row 2) — dark background
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // Merge A1:E1 for the progress bar label
        {
          mergeCells: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
            mergeType: 'MERGE_ALL',
          },
        },
        // Format B1 as percentage
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'PERCENT', pattern: '0%' },
                backgroundColor: { red: 0.13, green: 0.55, blue: 0.13 },
                textFormat: { bold: true, fontSize: 14, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(numberFormat,backgroundColor,textFormat,horizontalAlignment)',
          },
        },
        // Auto resize columns
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 5 },
          },
        },
      ],
    },
  });

  employee.statusSheetId = spreadsheetId;
  console.log(`[Status] Created status sheet for ${employee.name} → https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  return spreadsheetId;
}

// ─── Update a single milestone row ───────────────────────────────────────────
async function updateMilestone(auth, employee, milestoneIndex, status, notes = '') {
  try {
    const spreadsheetId = await getOrCreateStatusSheet(auth, employee);
    const sheets = google.sheets({ version: 'v4', auth });

    // Row 1 = progress bar, Row 2 = header, milestones start at row 3 → index + 3
    const rowNum = milestoneIndex + 3;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Status!B${rowNum}:D${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status, nowIST(), notes]] },
    });

    console.log(`[Status] "${MILESTONES[milestoneIndex]}" → ${status}${notes ? ' | ' + notes : ''}`);
  } catch (err) {
    console.error(`[Status] Failed to update milestone ${milestoneIndex}:`, err.message);
  }
}

// ─── Named milestone updaters ─────────────────────────────────────────────────

async function markPreonboardingInitiated(auth, employee) {
  await updateMilestone(auth, employee, 0, STATUS.DONE);
}

async function markDocumentsReceived(auth, employee, docType) {
  await updateMilestone(auth, employee, 1, STATUS.IN_PROGRESS, docType || '');
}

async function markDocumentIssue(auth, employee, docType, reason) {
  await updateMilestone(auth, employee, 2, STATUS.NOT_OK, `${docType}: ${reason}`);
}

async function markDocumentsVerifiedOk(auth, employee) {
  await updateMilestone(auth, employee, 2, STATUS.DONE, 'All documents verified');
  await updateMilestone(auth, employee, 3, STATUS.DONE);
}

async function markOfficialEmailConfirmed(auth, employee, officialEmail) {
  await updateMilestone(auth, employee, 4, STATUS.DONE, officialEmail || '');
}

async function markManagerConfirmed(auth, employee, details) {
  const notes = [details.officeLocation, details.assetType, details.supervisorName]
    .filter(Boolean).join(' | ');
  await updateMilestone(auth, employee, 5, STATUS.DONE, notes);
}

async function markITConfirmed(auth, employee) {
  await updateMilestone(auth, employee, 6, STATUS.DONE);
}

async function markBGVDone(auth, employee) {
  await updateMilestone(auth, employee, 7, STATUS.DONE);
}

async function markHRInductionScheduled(auth, employee) {
  await updateMilestone(auth, employee, 8, STATUS.DONE);
}

async function markProjectIntroScheduled(auth, employee) {
  await updateMilestone(auth, employee, 9, STATUS.DONE);
}

async function markOnboardingComplete(auth, employee) {
  await updateMilestone(auth, employee, 10, STATUS.DONE);
}

async function mark30DayDone(auth, employee) {
  await updateMilestone(auth, employee, 11, STATUS.DONE);
}

async function mark60DayDone(auth, employee) {
  await updateMilestone(auth, employee, 12, STATUS.DONE);
}

async function mark90DayDone(auth, employee) {
  await updateMilestone(auth, employee, 13, STATUS.DONE);
}

async function markPreprobationDone(auth, employee) {
  await updateMilestone(auth, employee, 14, STATUS.DONE);
}

module.exports = {
  STATUS,
  MILESTONES,
  getOrCreateStatusSheet,
  updateMilestone,
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
};
