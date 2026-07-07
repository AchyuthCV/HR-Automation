// masterDashboard.js — one Google Sheet showing ALL employees, all 16 milestones
//
// Row 1: title banner + last updated
// Row 2: column headers
// Row 3+: one row per employee, colour-coded milestone cells
//
// Call getOrCreateMasterDashboard(auth) once on startup to get the sheet ID.
// Call updateMasterDashboard(auth, employees) after every saveState.

const { google } = require('googleapis');
const config = require('./config');

const DASHBOARD_TITLE = 'Alethea HR Onboarding Dashboard';

const MILESTONES = [
  'Pre-onboarding',
  'Docs Received',
  'Re-upload Requested',
  'Docs Verified',
  'Official Email',
  'Manager Confirmed',
  'IT Assets',
  'BGV Done',
  'HR Induction',
  'Project Intro',
  'Day of Joining',
  'Day 25 Catchup',
  'Day 30 Catchup',
  'Day 60 Review',
  'Day 90 Review',
  'Pre-probation',
];

// Checklist task keys that map to each milestone (same order as MILESTONES)
const MILESTONE_TASKS = [
  't1',   // pre-onboarding form sent
  't3',   // documents received
  't4',   // re-upload requested (notOk)
  't5',   // documents verified
  't6',   // official email confirmed
  't7',   // manager confirmed
  't8',   // IT confirmed
  't9',   // BGV done
  't10',  // HR induction scheduled
  't11',  // project intro scheduled
  't12',  // DOJ / onboarding complete
  't13',  // day 25 catchup
  't14',  // day 30 catchup
  't15',  // day 60 review
  't16',  // day 90 review
  't17',  // pre-probation done
];

// Colours as {red, green, blue} in 0–1 range (Sheets API format)
const COLOUR = {
  headerBg:   { red: 0.11, green: 0.11, blue: 0.15 },  // near-black slate
  titleBg:    { red: 0.04, green: 0.36, blue: 0.60 },  // deep corporate blue
  white:      { red: 1,    green: 1,    blue: 1    },
  done:       { red: 0.13, green: 0.55, blue: 0.13 },  // green
  doneText:   { red: 1,    green: 1,    blue: 1    },
  pending:    { red: 1,    green: 0.92, blue: 0.70 },  // pale amber
  pendingText:{ red: 0.40, green: 0.26, blue: 0.02 },
  notOk:      { red: 0.95, green: 0.22, blue: 0.22 },  // red
  notOkText:  { red: 1,    green: 1,    blue: 1    },
  rowEven:    { red: 0.96, green: 0.97, blue: 0.99 },
  rowOdd:     { red: 1,    green: 1,    blue: 1    },
  overdue:    { red: 1,    green: 0.60, blue: 0.30 },  // orange
  overdueText:{ red: 0.45, green: 0.12, blue: 0.00 },
};

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: config.timezone });
}

function daysFromDOJ(doj) {
  if (!doj) return null;
  const ms = Date.now() - new Date(doj).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function pctComplete(checklist) {
  const tasks = Object.values(checklist || {});
  if (!tasks.length) return 0;
  const done = tasks.filter(t => t && t.done).length;
  return Math.round((done / tasks.length) * 100);
}

function isTaskDone(checklist, taskId) {
  return !!(checklist && checklist[taskId] && checklist[taskId].done);
}

// Determine if a milestone is overdue based on DOJ + expected day range
function milestoneStatus(employee, milestoneIdx) {
  const taskKey = MILESTONE_TASKS[milestoneIdx];
  const done = isTaskDone(employee.checklist, taskKey);
  if (done) return 'done';

  // t4 (re-upload) is only relevant if explicitly triggered — skip otherwise
  if (taskKey === 't4') {
    return isTaskDone(employee.checklist, 't4') ? 'notok' : 'na';
  }

  const days = daysFromDOJ(employee.doj);
  if (days === null) return 'pending';

  // Overdue thresholds (days after DOJ)
  const overdueAfter = {
    t1: -5,   // pre-onboarding should be done before joining
    t3: 1,    // docs within 1 day of joining
    t5: 3,    // verification within 3 days
    t6: 3,
    t7: 3,
    t8: 3,
    t9: 5,
    t10: 7,
    t11: 7,
    t12: 0,   // DOJ itself
    t13: 25,
    t14: 30,
    t15: 60,
    t16: 90,
    t17: 90,
  };

  const threshold = overdueAfter[taskKey];
  if (threshold !== undefined && days > threshold) return 'overdue';
  return 'pending';
}

// ─── Retry helper ─────────────────────────────────────────────────────────────
async function apiWithRetry(fn, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.code || (err.response && err.response.status);
      const retryable = !status || status === 429 || status >= 500;
      if (attempt === maxAttempts || !retryable) throw err;
      const delay = attempt * 3000;
      console.warn(`[Dashboard] "${label}" attempt ${attempt} failed — retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Get or create the master dashboard sheet ─────────────────────────────────
async function getOrCreateMasterDashboard(auth) {
  const drive  = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // Look for existing sheet in root of Drive
  const existing = await apiWithRetry(() => drive.files.list({
    q: `name='${DASHBOARD_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  }), 'findDashboard');

  if (existing.data.files.length > 0) {
    const id = existing.data.files[0].id;
    console.log(`[Dashboard] Found existing dashboard: ${id}`);
    return id;
  }

  console.log('[Dashboard] Creating master dashboard sheet...');
  const spreadsheet = await apiWithRetry(() => sheets.spreadsheets.create({
    requestBody: {
      properties: { title: DASHBOARD_TITLE },
      sheets: [{ properties: { title: 'Dashboard' } }],
    },
  }), 'createDashboard');

  const spreadsheetId = spreadsheet.data.spreadsheetId;
  console.log(`[Dashboard] Created dashboard: ${spreadsheetId}`);
  return spreadsheetId;
}

// ─── Main update function ─────────────────────────────────────────────────────
async function updateMasterDashboard(auth, employees) {
  if (!employees || employees.length === 0) {
    console.log('[Dashboard] No employees to render — skipping');
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth });
  let spreadsheetId;

  try {
    spreadsheetId = await getOrCreateMasterDashboard(auth);
  } catch (err) {
    console.error('[Dashboard] Failed to get/create sheet:', err.message);
    return;
  }

  // Get sheetId (numeric) for the Dashboard tab
  const meta = await apiWithRetry(() => sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  }), 'getSheetMeta');

  const sheetProps = meta.data.sheets[0].properties;
  const sheetId = sheetProps.sheetId;

  // ── Build value rows ──────────────────────────────────────────────────────
  const now = nowIST();

  // Row 1: title banner
  const titleRow = [`${config.companyName || 'Alethea'} HR Onboarding Dashboard`, ...Array(MILESTONES.length + 5).fill('')];

  // Row 2: column headers
  const headerRow = [
    'Emp ID', 'Name', 'DOJ', 'Days', 'Status', '% Done',
    ...MILESTONES,
  ];

  // Data rows (one per employee)
  const dataRows = employees.map(emp => {
    const days = daysFromDOJ(emp.doj);
    const pct  = pctComplete(emp.checklist);
    const dojDisplay = emp.doj ? emp.doj.split('T')[0] : '—';
    const daysDisplay = days !== null ? (days < 0 ? `${Math.abs(days)}d until DOJ` : `Day ${days}`) : '—';

    let status = 'Pending';
    if (pct === 100) status = 'Complete';
    else if (pct >= 50) status = 'In Progress';
    else if (pct > 0) status = 'Started';

    const milestoneValues = MILESTONES.map((_, i) => {
      const s = milestoneStatus(emp, i);
      if (s === 'done')    return '✓';
      if (s === 'overdue') return '!';
      if (s === 'notok')   return '✗';
      if (s === 'na')      return '—';
      return '○';
    });

    return [
      emp.employeeId,
      emp.name,
      dojDisplay,
      daysDisplay,
      status,
      `${pct}%`,
      ...milestoneValues,
    ];
  });

  // Last row: legend
  const legendRow = ['', '', '', '', '', 'Legend:', '✓ Done', '○ Pending', '! Overdue', '✗ Issue', '—', `Updated: ${now}`, ...Array(MILESTONES.length - 6).fill('')];

  const allRows = [titleRow, headerRow, ...dataRows, legendRow];
  const totalRows = allRows.length;
  const totalCols = headerRow.length;

  // ── Write values ───────────────────────────────────────────────────────────
  await apiWithRetry(() => sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Dashboard',
  }), 'clearSheet');

  await apiWithRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: allRows },
  }), 'writeValues');

  // ── Format requests ────────────────────────────────────────────────────────
  const requests = [];

  // Title row (row 0): merge all, dark blue bg, white bold text, large font
  requests.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols },
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOUR.titleBg,
          textFormat: { bold: true, fontSize: 16, foregroundColor: COLOUR.white },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 50 },
      fields: 'pixelSize',
    },
  });

  // Header row (row 1): dark bg, white bold
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOUR.headerBg,
          textFormat: { bold: true, fontSize: 10, foregroundColor: COLOUR.white },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 44 },
      fields: 'pixelSize',
    },
  });

  // Employee data rows: alternating background, centre-align milestone columns
  for (let i = 0; i < employees.length; i++) {
    const rowIdx = i + 2; // 0-indexed; rows 0=title, 1=header, 2+=data
    const bg = i % 2 === 0 ? COLOUR.rowEven : COLOUR.rowOdd;

    // Base row background + font
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: bg,
            textFormat: { fontSize: 10 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
      },
    });

    // Milestone cells (columns 6 onwards): colour-coded individually
    for (let m = 0; m < MILESTONES.length; m++) {
      const colIdx = m + 6;
      const status = milestoneStatus(employees[i], m);
      let cellBg, cellFg;
      if (status === 'done')    { cellBg = COLOUR.done;    cellFg = COLOUR.doneText;    }
      else if (status === 'overdue') { cellBg = COLOUR.overdue; cellFg = COLOUR.overdueText; }
      else if (status === 'notok')   { cellBg = COLOUR.notOk;   cellFg = COLOUR.notOkText;   }
      else { cellBg = COLOUR.pending; cellFg = COLOUR.pendingText; }

      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: cellBg,
              textFormat: { bold: status === 'done', fontSize: 11, foregroundColor: cellFg },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });
    }

    // % Done column (col 5): bold
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    });
  }

  // Legend row: light grey bg
  const legendRowIdx = 2 + employees.length;
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: legendRowIdx, endRowIndex: legendRowIdx + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.92, green: 0.92, blue: 0.92 },
          textFormat: { italic: true, fontSize: 9 },
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
    },
  });

  // Column widths: ID, Name, DOJ, Days, Status, %, then milestone cols
  const colWidths = [70, 160, 90, 90, 90, 60, ...Array(MILESTONES.length).fill(78)];
  colWidths.forEach((px, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    });
  });

  // Freeze first 2 rows (title + header). Do NOT freeze columns — the title row
  // is merged across all columns and Sheets rejects a column freeze that cuts
  // through a merged region.
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 2, frozenColumnCount: 0 },
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });

  // Row height for data rows: 36px
  if (employees.length > 0) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 2, endIndex: 2 + employees.length },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    });
  }

  // Apply all formatting in one shot
  await apiWithRetry(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  }), 'batchFormat');

  console.log(`[Dashboard] Updated master dashboard (${employees.length} employees) — https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  return spreadsheetId;
}

module.exports = { getOrCreateMasterDashboard, updateMasterDashboard };
