// createExpenseSheet.js
// Standalone script — creates the Alethea Expense Settlement Sheet v1.1
// in the Bills Drive folder for a given month.
//
// Usage:
//   node createExpenseSheet.js "July 2026"
//   node createExpenseSheet.js           ← defaults to current month
//
// Output: prints the URL of the created Google Sheet

// Use node_modules from the automation folder
const automationDir = require('path').join(__dirname, '..', 'automation');
require('module').globalPaths.push(require('path').join(automationDir, 'node_modules'));

const dotenv = require(require('path').join(automationDir, 'node_modules', 'dotenv'));
dotenv.config({ path: require('path').join(automationDir, '.env') });

const { google } = require(require('path').join(automationDir, 'node_modules', 'googleapis'));
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const BILLS_FOLDER_ID = '1riOhGs9j2cVuAWHvDx-yook3mozB649T';

// ── Auth (reuses HR engine credentials) ──────────────────────────────────────
function getAuth() {
  const credsPath = path.join(__dirname, '..', 'automation', 'credentials.json');
  const tokenPath = path.join(__dirname, '..', 'automation', 'token.json');
  const creds = JSON.parse(fs.readFileSync(credsPath));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  auth.setCredentials(JSON.parse(fs.readFileSync(tokenPath)));
  return auth;
}

// ── Colours ───────────────────────────────────────────────────────────────────
const YELLOW     = { red: 1,    green: 0.949, blue: 0.8   }; // #FFF2CC — AI fills
const BLUE_LIGHT = { red: 0.72, green: 0.882, blue: 0.996 }; // #B8E1FE — manual
const HEADER_BG  = { red: 0.18, green: 0.459, blue: 0.714 }; // #2E75B6 — section header
const WHITE      = { red: 1,    green: 1,     blue: 1     };
const LIGHT_GREY = { red: 0.95, green: 0.95,  blue: 0.95  };

function rgb(c) { return { red: c.red, green: c.green, blue: c.blue }; }

function cellBg(sheetId, row, col, colEnd, color) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: colEnd },
      cell: { userEnteredFormat: { backgroundColor: rgb(color) } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  };
}

function bold(sheetId, row, col, colEnd, fontSize) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: colEnd },
      cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: fontSize || 10 } } },
      fields: 'userEnteredFormat.textFormat',
    },
  };
}

function border(sheetId, startRow, endRow, startCol, endCol) {
  const side = { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } };
  return {
    updateBorders: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      top: side, bottom: side, left: side, right: side,
      innerHorizontal: side, innerVertical: side,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Resolve month label
  const monthLabel = process.argv[2] || new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  console.log(`Creating expense sheet for: ${monthLabel}`);

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive  = google.drive({ version: 'v3', auth });

  // ── 1. Create spreadsheet ─────────────────────────────────────────────────
  const ss = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Alethea Expense Settlement — ${monthLabel}` },
      sheets: [{ properties: { title: monthLabel, gridProperties: { rowCount: 60, columnCount: 12 } } }],
    },
  });

  const spreadsheetId = ss.data.spreadsheetId;
  const sheetId       = ss.data.sheets[0].properties.sheetId;
  console.log(`Sheet created: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

  // ── 2. Write all cell values ───────────────────────────────────────────────
  // Column layout (0-indexed): A=0 B=1 C=2 D=3 E=4 F=5 G=6 H=7 I=8 J=9 K=10 L=11
  // Columns used: B(1)–L(11) matching the template screenshot

  const values = [
    // Row 0: logo (IMAGE formula)
    ['=IMAGE("https://aletheatech.com/wp-content/uploads/2022/01/Alethea-logo.png",1)'],
    // Row 1: blank
    [],
    // Row 2: title
    ['', '', '', '', '', '', '', 'Alethea Expense Settlement Sheet v1.1'],
    // Row 3: Instructions header
    ['Instructions'],
    // Row 4-8: Instructions
    ['', '1', 'Fill/change all and only the shaded cells. Add more rows in the expense item details sections if needed.'],
    ['', '2', 'Enter details of only one currency in this sheet. If your settlement involves multiple currencies, use multiple copies of this sheet and rename them.'],
    ['', '3', 'Make sure appropriate "ExpenseTypes & CostCategory" is selected from the pull-down-menu. Each expense item should have an "ExpenseType & CostCategory".'],
    ['', '4', '"Date" should be the date on the receipt. Each item should have a receipt. Check if all calculations done by sheet are correct.'],
    ['', '5', 'Download as pdf (select: no gridlines, portrait) and check if sheet will get printed ok. Print and sign and attach with receipts and send to finance.'],
    // Row 9: blank
    [],
    // Row 10: Name / Settlement period start
    ['Name', '', '', '', 'Settlement period start date', '', '', '', '', '', 'Per Diem', ''],
    // Row 11: EmpID / Cost Center / Settlement period end
    ['EmpID', '', 'Cost Center', 'C-ADMIN', 'Settlement period end date', '', '', '', '', '', 'Per Diem eligible days', ''],
    // Row 12: Expense Type / Currency
    ['Expense Type', '', '', 'Other', 'Currency CCY [eg:USD/INR]', '', '', 'INR', '', '', 'Total Per Diem eligible', '0'],
    // Row 13: blank
    [],
    // Row 14: Employee Remarks
    ['Employee Remarks', '', '', '', '', '', '', '', '', '', '', ''],
    // Row 15: blank
    [],
    // Row 16: blank
    [],
    // Row 17: Card expenses section header
    ['Card expenses', '', '', '', '', '', '', '', 'Total advance amount received in card', '', '', '0'],
    // Row 18: Card expenses column headers
    ['Date', 'Description', '', '', '', '', '', 'Receipt Nr', 'ExpenseType', 'Cost Category', 'Asset Yes/No', 'Amount'],
    // Rows 19-23: Card expense data rows (5 rows, AI fills yellow)
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    // Row 24: leave blank instruction
    ['', '<Leave this line blank & Insert new lines above this line and format>', '', '', '', '', '', '', '', '', '', ''],
    // Row 25: Card totals
    ['', 'Card balance', '0', '', 'Total personal', '0', '', 'Total official', '0', 'Total card expenses', '', '0'],
    // Row 26: blank
    [],
    // Row 27: Cash expenses section header
    ['Cash expenses', '', '', '', '', '', '', '', 'Total advance amount received in cash', '', '', '0'],
    // Row 28: Cash expenses column headers
    ['Date', 'Description', '', '', '', '', '', 'Receipt Nr', 'ExpenseType', 'Cost Category', '', 'Amount'],
    // Rows 29-43: Cash expense data rows (15 rows, AI fills yellow)
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    ['', '', '', '', '', '', '', '', '', '', 'NO', ''],
    // Row 44: leave blank instruction
    ['', '<Leave this line blank & Insert new lines above this line and format>', '', '', '', '', '', '', '', '', '', ''],
    // Row 45: Cash totals
    ['', 'Cash balance', '0', '', 'Total personal', '0', '', 'Total official', '0', 'Total cash expenses', '', '0'],
    // Row 46: blank
    [],
    // Row 47: Grand total
    ['', '', '', '', '', '', '', '', '', 'Grand Total', '', '0'],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${monthLabel}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  // ── 3. Formatting requests ─────────────────────────────────────────────────
  const requests = [];

  // Title row (row 2) — bold, centered, large
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 12 },
      cell: { userEnteredFormat: {
        textFormat: { bold: true, fontSize: 13 },
        horizontalAlignment: 'CENTER',
      }},
      fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
    },
  });

  // Instructions header bold
  requests.push(bold(sheetId, 3, 0, 4, 10));

  // Header fields background (rows 10-14) — light cream
  for (let r = 10; r <= 14; r++) {
    requests.push(cellBg(sheetId, r, 0, 12, LIGHT_GREY));
  }

  // Name, EmpID, Expense Type cells — yellow (AI fills)
  // Row 10 col 1-3 (Name value)
  requests.push(cellBg(sheetId, 10, 1, 4, YELLOW));
  // Row 10 col 7-9 (Per Diem value)
  requests.push(cellBg(sheetId, 10, 11, 12, YELLOW));
  // Row 11 col 1 (EmpID value), col 11 (Per Diem eligible days)
  requests.push(cellBg(sheetId, 11, 1, 2, YELLOW));
  requests.push(cellBg(sheetId, 11, 11, 12, YELLOW));
  // Row 12 col 11 (Total Per Diem)
  requests.push(cellBg(sheetId, 12, 11, 12, YELLOW));
  // Row 10 col 7-9 (Settlement start date value)
  requests.push(cellBg(sheetId, 10, 7, 10, YELLOW));
  // Row 11 col 7-9 (Settlement end date value)
  requests.push(cellBg(sheetId, 11, 7, 10, YELLOW));
  // Row 14 (Employee Remarks) — yellow
  requests.push(cellBg(sheetId, 14, 1, 12, YELLOW));

  // Card expenses section header (row 17) — blue header
  requests.push(cellBg(sheetId, 17, 0, 12, HEADER_BG));
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 0, endColumnIndex: 12 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: WHITE } } },
      fields: 'userEnteredFormat.textFormat',
    },
  });

  // Card column headers (row 18) — bold
  requests.push(bold(sheetId, 18, 0, 12, 10));
  requests.push(cellBg(sheetId, 18, 0, 12, LIGHT_GREY));

  // Card data rows 19-23 — yellow for AI cols (Date=0, Desc=1-6, ReceiptNr=7, Amount=11)
  // Blue for manual cols (ExpenseType=8, CostCategory=9)
  for (let r = 19; r <= 23; r++) {
    requests.push(cellBg(sheetId, r, 0, 8,  YELLOW));  // Date, Description, Receipt Nr
    requests.push(cellBg(sheetId, r, 8, 10, BLUE_LIGHT)); // ExpenseType, Cost Category
    requests.push(cellBg(sheetId, r, 11, 12, YELLOW));  // Amount
  }

  // Cash expenses section header (row 27) — blue header
  requests.push(cellBg(sheetId, 27, 0, 12, HEADER_BG));
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 27, endRowIndex: 28, startColumnIndex: 0, endColumnIndex: 12 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: WHITE } } },
      fields: 'userEnteredFormat.textFormat',
    },
  });

  // Cash column headers (row 28) — bold yellow (matching template)
  requests.push(bold(sheetId, 28, 0, 12, 10));
  requests.push(cellBg(sheetId, 28, 0, 12, { red: 1, green: 0.898, blue: 0 })); // bright yellow header

  // Cash data rows 29-43 — yellow for AI cols, blue for manual
  for (let r = 29; r <= 43; r++) {
    requests.push(cellBg(sheetId, r, 0, 8,  YELLOW));      // Date, Desc, Receipt Nr
    requests.push(cellBg(sheetId, r, 8, 10, BLUE_LIGHT));  // ExpenseType, Cost Category
    requests.push(cellBg(sheetId, r, 11, 12, YELLOW));     // Amount
  }

  // Totals rows — bold
  requests.push(bold(sheetId, 25, 0, 12, 10));
  requests.push(bold(sheetId, 45, 0, 12, 10));
  requests.push(bold(sheetId, 47, 0, 12, 11));

  // Grand total row highlight
  requests.push(cellBg(sheetId, 47, 9, 12, { red: 0.18, green: 0.459, blue: 0.714 }));
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 47, endRowIndex: 48, startColumnIndex: 9, endColumnIndex: 12 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: WHITE, fontSize: 11 } } },
      fields: 'userEnteredFormat.textFormat',
    },
  });

  // Borders around card and cash data sections
  requests.push(border(sheetId, 18, 26, 0, 12));
  requests.push(border(sheetId, 28, 46, 0, 12));

  // ExpenseType dropdowns — Card rows 19-23
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 19, endRowIndex: 24, startColumnIndex: 8, endColumnIndex: 9 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: 'Personal' },
            { userEnteredValue: 'Accommodation' },
            { userEnteredValue: 'Subsistence' },
            { userEnteredValue: 'Travel' },
            { userEnteredValue: 'Entertaining' },
            { userEnteredValue: 'Others' },
          ],
        },
        showCustomUi: true,
        strict: false,
      },
    },
  });

  // ExpenseType dropdowns — Cash rows 29-43
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 29, endRowIndex: 44, startColumnIndex: 8, endColumnIndex: 9 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: 'Personal' },
            { userEnteredValue: 'Accommodation' },
            { userEnteredValue: 'Subsistence' },
            { userEnteredValue: 'Travel' },
            { userEnteredValue: 'Entertaining' },
            { userEnteredValue: 'Others' },
          ],
        },
        showCustomUi: true,
        strict: false,
      },
    },
  });

  // Merge title cell
  requests.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 12 },
      mergeType: 'MERGE_ALL',
    },
  });

  // Column widths
  const colWidths = [120, 80, 80, 80, 120, 80, 80, 100, 110, 120, 90, 100];
  colWidths.forEach((px, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    });
  });

  // Logo row tall enough to display
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 80 },
      fields: 'pixelSize',
    },
  });

  // Data rows taller for readability
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 19, endIndex: 44 },
      properties: { pixelSize: 22 },
      fields: 'pixelSize',
    },
  });

  // Freeze only the column header row of card expenses (row 19 = index 18)
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 0 } },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // ── 4. Move to Bills folder ────────────────────────────────────────────────
  const fileMeta = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
  const currentParents = (fileMeta.data.parents || []).join(',');
  await drive.files.update({
    fileId: spreadsheetId,
    addParents: BILLS_FOLDER_ID,
    removeParents: currentParents,
    fields: 'id, parents',
  });

  // ── 5. Share with Alethea account ─────────────────────────────────────────
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: 'achyuth.cv@aletheatech.com' },
    sendNotificationEmail: true,
  }).catch(err => console.warn('Could not share with achyuth.cv@alethea.com:', err.message));

  console.log(`\nDone! Expense sheet for ${monthLabel} created in Bills folder.`);
  console.log(`URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
