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
const config = require('./config');

// Retry async Google API calls on transient errors (429, 5xx, network)
async function apiWithRetry(fn, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.code || (err.response && err.response.status);
      const retryable = !status || status === 429 || status >= 500;
      if (attempt === maxAttempts || !retryable) throw err;
      const delay = attempt * 3000;
      console.warn(`[Status] "${label}" attempt ${attempt} failed (${err.message}) — retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

const STATUS = {
  PENDING:     config.statusSymbols.pending,
  IN_PROGRESS: config.statusSymbols.inProgress,
  DONE:        config.statusSymbols.done,
  ACTION_REQ:  config.statusSymbols.actionReq,
  NOT_OK:      config.statusSymbols.notOk,
};

const MILESTONES = [
  'Pre-onboarding initiated',
  'Documents received',
  'Documents not ok — re-upload requested',
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
  return new Date().toLocaleString('en-IN', { timeZone: config.timezone });
}

// ─── Get or create the status sheet for an employee ──────────────────────────
async function getOrCreateStatusSheet(auth, employee) {
  if (employee.statusSheetId) return employee.statusSheetId;

  const drive  = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // Status sheet goes in the root onboarding folder (visible to HR only, not employee)
  const targetFolderId = employee.rootFolderId || employee.driveFolderId;
  console.log(`[Status] Creating sheet for ${employee.name} in folder ${targetFolderId}`);

  // Check if sheet already exists in root folder
  const existing = await apiWithRetry(() => drive.files.list({
    q: `name='Onboarding Status — ${employee.name} (${employee.employeeId})' and '${targetFolderId}' in parents and trashed=false`,
    fields: 'files(id)',
  }), 'getOrCreateStatusSheet:list');

  if (existing.data.files.length > 0) {
    employee.statusSheetId = existing.data.files[0].id;
    console.log(`[Status] Found existing status sheet for ${employee.name}`);
    return employee.statusSheetId;
  }

  // Create new spreadsheet
  const spreadsheet = await apiWithRetry(() => sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Onboarding Status — ${employee.name} (${employee.employeeId})` },
      sheets: [{ properties: { title: 'Status' } }],
    },
  }), 'getOrCreateStatusSheet:create');

  const spreadsheetId = spreadsheet.data.spreadsheetId;
  const sheetId = spreadsheet.data.sheets[0].properties.sheetId;

  // Move it into the root onboarding folder (HR-only view).
  // Must remove the default "My Drive" parent or the file stays in both places.
  const fileMeta = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
  const currentParents = (fileMeta.data.parents || []).join(',');
  await drive.files.update({
    fileId: spreadsheetId,
    addParents: targetFolderId,
    removeParents: currentParents,
    fields: 'id, parents',
  });

  // Write header + all 15 milestones + progress bar row at top
  const now = nowIST();
  const doneLabel = STATUS.DONE;
  const countifFormula = '=COUNTIF(B3:B17,"' + doneLabel + '")/15';
  const pctFormula = '=TEXT(COUNTIF(B3:B17,"' + doneLabel + '")/15,"0%")&" Complete ("&COUNTIF(B3:B17,"' + doneLabel + '")&")/15)"';
  // Row 1: progress bar  Row 2: column headers  Rows 3-17: milestones
  const rows = [
    ['Onboarding Progress', countifFormula, '', pctFormula],
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

  // Grant employee view-only access so they can track their own onboarding progress
  const emailToShare = employee.personalEmail || employee.officialEmail;
  if (emailToShare) {
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'reader', emailAddress: emailToShare },
        sendNotificationEmail: false,
      });
      console.log(`[Status] Shared status sheet with ${emailToShare} (view only)`);
    } catch (err) {
      console.warn(`[Status] Could not share sheet with ${emailToShare}: ${err.message}`);
    }
  }

  return spreadsheetId;
}

// ─── Update a single milestone row ───────────────────────────────────────────
async function updateMilestone(auth, employee, milestoneIndex, status, notes = '') {
  try {
    const spreadsheetId = await getOrCreateStatusSheet(auth, employee);
    const sheets = google.sheets({ version: 'v4', auth });

    const rowNum = milestoneIndex + 3;
    await apiWithRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Status!B${rowNum}:D${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status, nowIST(), notes]] },
    }), `updateMilestone:${milestoneIndex}`);

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
  // Don't downgrade if documents are already fully verified (row 6 = milestone index 3)
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const spreadsheetId = await getOrCreateStatusSheet(auth, employee);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Status!B6',
    });
    const currentStatus = (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
    if (currentStatus === STATUS.DONE) return;
  } catch { /* fall through and update anyway */ }
  await updateMilestone(auth, employee, 1, STATUS.IN_PROGRESS, docType || '');
}

async function markDocumentIssue(auth, employee, docType, reason) {
  await updateMilestone(auth, employee, 2, STATUS.NOT_OK, `${docType}: ${reason}`);
}

async function markDocumentsVerifiedOk(auth, employee) {
  // Only mark the "Documents not ok" row (index 2) as Done if it was previously set to NOT_OK
  // (i.e. a rejection was issued). If no rejection ever happened, leave row 2 as Pending.
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const spreadsheetId = await getOrCreateStatusSheet(auth, employee);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Status!B5' });
    const current = (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
    if (current === STATUS.NOT_OK) {
      await updateMilestone(auth, employee, 2, STATUS.DONE, 'Issue resolved — all documents verified');
    }
  } catch { /* fall through */ }
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
  await revokeEmployeeSheetAccess(auth, employee);
}

// Revoke the employee's view access to their status sheet once onboarding is fully complete
async function revokeEmployeeSheetAccess(auth, employee) {
  const spreadsheetId = employee.statusSheetId;
  if (!spreadsheetId) return;

  const emailToRevoke = employee.personalEmail || employee.officialEmail;
  if (!emailToRevoke) return;

  try {
    const drive = google.drive({ version: 'v3', auth });

    // List all permissions on the sheet to find the employee's permission ID
    const perms = await drive.permissions.list({
      fileId: spreadsheetId,
      fields: 'permissions(id, emailAddress, role)',
    });

    const empPerm = (perms.data.permissions || []).find(
      p => p.emailAddress && p.emailAddress.toLowerCase() === emailToRevoke.toLowerCase()
    );

    if (!empPerm) {
      console.log(`[Status] No active permission found for ${emailToRevoke} on status sheet — nothing to revoke`);
      return;
    }

    await drive.permissions.delete({
      fileId: spreadsheetId,
      permissionId: empPerm.id,
    });

    console.log(`[Status] Revoked sheet access for ${emailToRevoke} — onboarding complete`);
  } catch (err) {
    console.warn(`[Status] Could not revoke sheet access for ${emailToRevoke}: ${err.message}`);
  }
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
  revokeEmployeeSheetAccess,
  createProjectIntroSheet,
};

// ─── Project Intro Sheet ───────────────────────────────────────────────────────
// Creates a Google Sheet in the employee's Reports folder with all known details
// pre-filled. Manager fills in Key Projects, Initial Goals, and Buddy Name.
// Returns the sheet URL, or null on failure.
async function createProjectIntroSheet(auth, employee) {
  if (employee.projectIntroSheetId) {
    // Already created — return the URL
    return `https://docs.google.com/spreadsheets/d/${employee.projectIntroSheetId}`;
  }

  const drive  = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const { name, employeeId, doj, officialEmail, personalEmail, contacts } = employee;
  const role = employee.role || employee.designation || '—';
  const managerEmail = (contacts && contacts.managerEmail) || '—';
  const recruiterEmail = (contacts && contacts.recruiterEmail) || '—';

  try {
    // Create spreadsheet
    const spreadsheet = await apiWithRetry(() => sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `Project Intro Sheet — ${name} (${employeeId})` },
        sheets: [{ properties: { title: 'Project Intro' } }],
      },
    }), 'createProjectIntroSheet:create');

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const sheetId = spreadsheet.data.sheets[0].properties.sheetId;

    // Pre-fill all known data; manager fills highlighted rows
    const rows = [
      ['Project Intro Sheet', `${name} (${employeeId})`],
      [''],
      ['Field', 'Value', 'Notes'],
      ['Employee Name',     name,                          ''],
      ['Employee ID',       employeeId,                    ''],
      ['Role / Designation',role,                          ''],
      ['Date of Joining',   doj,                           ''],
      ['Official Email',    officialEmail || '(pending)',  ''],
      ['Personal Email',    personalEmail || '—',          ''],
      ['Reporting Manager', managerEmail,                  ''],
      ['Recruiter',         recruiterEmail,                ''],
      [''],
      ['— To be filled by Manager before meeting —', '', ''],
      ['Key Projects',      '', '(Please fill before meeting)'],
      ['Initial Goals',     '', '(Please fill before meeting)'],
      ['Buddy / Mentor',    '', '(Please assign)'],
      ['Team Name',         '', '(Please fill)'],
      [''],
      ['— Review Updates (updated by automation) —', '', ''],
      ['30-Day Review Summary', '', ''],
      ['60-Day Review Summary', '', ''],
      ['90-Day Review Summary', '', ''],
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Project Intro!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    // Format: title row, headers, manager-fill section highlighted
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Title row — dark blue
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: {
                backgroundColor: { red: 0.1, green: 0.27, blue: 0.6 },
                textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 1, green: 1, blue: 1 } },
              }},
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
          // Column headers row
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 2, endRowIndex: 3 },
              cell: { userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              }},
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
          // Manager section header — orange highlight
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 12, endRowIndex: 13 },
              cell: { userEnteredFormat: {
                backgroundColor: { red: 1, green: 0.6, blue: 0.2 },
                textFormat: { bold: true },
              }},
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
          // Manager-fill rows — light yellow background
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 13, endRowIndex: 17 },
              cell: { userEnteredFormat: {
                backgroundColor: { red: 1, green: 0.98, blue: 0.8 },
              }},
              fields: 'userEnteredFormat(backgroundColor)',
            },
          },
          // Auto-resize columns A and B
          { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 } } },
        ],
      },
    });

    // Move sheet into the employee's Reports subfolder if it exists, else root folder
    const reportsFolder = await drive.files.list({
      q: `name='Reports' and '${employee.driveFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    }).catch(() => null);
    const targetFolderId = (reportsFolder && reportsFolder.data.files.length > 0)
      ? reportsFolder.data.files[0].id
      : employee.driveFolderId;

    const introFileMeta = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
    const introCurrentParents = (introFileMeta.data.parents || []).join(',');
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: targetFolderId,
      removeParents: introCurrentParents,
      fields: 'id, parents',
    });

    // Share with manager and recruiter (edit access so they can fill it in)
    const shareWith = [managerEmail, recruiterEmail, officialEmail || personalEmail].filter(e => e && e !== '—');
    for (const email of [...new Set(shareWith)]) {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: email },
        sendNotificationEmail: false,
      }).catch(() => {});
    }

    employee.projectIntroSheetId = spreadsheetId;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    console.log(`[Status] Project intro sheet created for ${name}: ${sheetUrl}`);
    return sheetUrl;
  } catch (err) {
    console.error(`[Status] createProjectIntroSheet failed for ${name}: ${err.message}`);
    return null;
  }
}
