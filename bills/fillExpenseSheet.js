// fillExpenseSheet.js
// Reads all bills from the Bills Drive folder, extracts data with Gemini,
// and fills the yellow cells in the template expense sheet.
//
// Usage:
//   node fillExpenseSheet.js
//
// The script writes into the existing template sheet (1H4A-Bpe_vD76UgiojJoIcvPR5UtAn7mlggVKZWGNuak).
// It picks the sheet tab by month (e.g. "Jul 2026") based on the bill date.
// Card/UPI payments go into the Card section; cash goes into Cash section.

const automationDir = require('path').join(__dirname, '..', 'automation');
require('module').globalPaths.push(require('path').join(automationDir, 'node_modules'));

const dotenv = require(require('path').join(automationDir, 'node_modules', 'dotenv'));
dotenv.config({ path: require('path').join(automationDir, '.env') });

const { google } = require(require('path').join(automationDir, 'node_modules', 'googleapis'));
const { GoogleGenerativeAI } = require(require('path').join(automationDir, 'node_modules', '@google/generative-ai'));
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const BILLS_FOLDER_ID  = '1riOhGs9j2cVuAWHvDx-yook3mozB649T';
const TEMPLATE_SHEET_ID = '1H4A-Bpe_vD76UgiojJoIcvPR5UtAn7mlggVKZWGNuak';
const GEMINI_MODEL     = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const PROCESSED_LOG    = path.join(__dirname, 'processed_bills.json');

// Sheet layout (1-indexed rows as seen in sheet, converted to 0-index for API)
// Cash expense data rows: 25–54 (0-indexed: 24–53), 29 rows available
// Card expense data rows: 18–19 (0-indexed: 17–18), only 2 rows — template has limited card rows

// From our API read, the actual data rows are:
// Card header: row 17 (0-idx 16), data rows 18–19 (0-idx 17–18)
// Cash header: row 24 (0-idx 23), data rows 25–53 (0-idx 24–52)
// Columns (0-indexed): B=1, C=2, H=7, I=8, J=9, K=10, L=11

const CARD_DATA_START = 17; // 0-indexed row where card data begins
const CARD_DATA_END   = 19; // exclusive
const CASH_DATA_START = 24; // 0-indexed row where cash data begins
const CASH_DATA_END   = 53; // exclusive (29 rows)

// ── Auth ──────────────────────────────────────────────────────────────────────
function getAuth() {
  const credsPath = path.join(__dirname, '..', 'automation', 'credentials.json');
  const tokenPath = path.join(__dirname, '..', 'automation', 'token.json');
  const creds = JSON.parse(fs.readFileSync(credsPath));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  auth.setCredentials(JSON.parse(fs.readFileSync(tokenPath)));
  return auth;
}

// ── Processed log ─────────────────────────────────────────────────────────────
function loadProcessed() {
  try { return JSON.parse(fs.readFileSync(PROCESSED_LOG, 'utf8')); }
  catch { return {}; }
}

function saveProcessed(log) {
  fs.writeFileSync(PROCESSED_LOG, JSON.stringify(log, null, 2));
}

// ── Month tab name from date string ───────────────────────────────────────────
// Converts "2026-07-03" or "3 Jul 2026" → "Jul 2026"
function monthTabFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  // e.g. "Jul 2026"
}

// ── Format date for sheet ─────────────────────────────────────────────────────
function formatDateForSheet(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  // e.g. "03 Jul 2026"
}

// ── Read bill with Gemini ──────────────────────────────────────────────────────
async function readBillWithGemini(fileBuffer, mimeType, filename) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `You are reading a receipt or bill. Extract the following fields from this image/PDF.

Return ONLY valid JSON, no markdown, no extra text:
{
  "date": "YYYY-MM-DD or null if not found",
  "description": "Short merchant/vendor name only — e.g. 'Uber', 'Lulu Hypermarket', 'McDonald's', 'Swiggy', 'Amazon'. NOT a full sentence. Max 4 words.",
  "receipt_nr": "Receipt or invoice number as printed, or null",
  "amount": "Total amount paid as a number (no currency symbol), or null",
  "payment_method": "card", "upi", "cash", or "unknown" — read from the bill. UPI is treated as card. If bill says online/digital payment treat as card.",
  "currency": "INR or USD or whatever is on the bill, default INR"
}

Rules:
- date: use the date printed on the receipt (not today's date)
- description: merchant name only, short. If supermarket, use the store name. If taxi, use "Uber" or "Ola" etc.
- receipt_nr: the bill/receipt/invoice number printed on the document. If not present, use null.
- amount: the final total amount paid. If there are multiple amounts, pick the grand total.
- payment_method: look for words like "CARD", "UPI", "CASH", "Online", "GPay", "PhonePe", "Credit", "Debit"`;

  const result = await model.generateContent([
    { inlineData: { mimeType, data: fileBuffer.toString('base64') } },
    prompt,
  ]);

  const text = result.response.text().trim();
  // Strip markdown code fences if present
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error(`  [Gemini] Failed to parse response for ${filename}:`, clean.slice(0, 200));
    return null;
  }
}

// ── Find or create month tab ───────────────────────────────────────────────────
async function findOrCreateTab(sheets, spreadsheetId, tabName) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const existing = ss.data.sheets.find(s => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;

  // Create new tab by duplicating the most recent month tab as a base
  // Find a tab that looks like a month tab to duplicate
  const monthTab = ss.data.sheets.find(s => /[A-Z][a-z]+ \d{4}/.test(s.properties.title));
  if (monthTab) {
    const dupRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          duplicateSheet: {
            sourceSheetId: monthTab.properties.sheetId,
            insertSheetIndex: ss.data.sheets.length,
            newSheetName: tabName,
          },
        }],
      },
    });
    const newSheetId = dupRes.data.replies[0].duplicateSheet.properties.sheetId;
    // Clear the data rows in the new tab
    await clearDataRows(sheets, spreadsheetId, tabName);
    return newSheetId;
  }

  // Fallback: create blank sheet
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

// ── Clear data rows in a tab (so duplicated tab starts fresh) ─────────────────
async function clearDataRows(sheets, spreadsheetId, tabName) {
  const ranges = [
    `'${tabName}'!B18:L19`,  // card data rows
    `'${tabName}'!B25:L53`,  // cash data rows
  ];
  for (const range of ranges) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range }).catch(() => {});
  }
}

// ── Read existing filled rows from a tab ──────────────────────────────────────
async function getFilledRows(sheets, spreadsheetId, tabName) {
  // Returns { cardRows: number, cashRows: number }
  const cardRange = `'${tabName}'!B18:B19`;
  const cashRange = `'${tabName}'!B25:B53`;

  const [cardRes, cashRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: cardRange }).catch(() => ({ data: { values: [] } })),
    sheets.spreadsheets.values.get({ spreadsheetId, range: cashRange }).catch(() => ({ data: { values: [] } })),
  ]);

  const cardFilled = (cardRes.data.values || []).filter(r => r[0] && r[0].trim()).length;
  const cashFilled = (cashRes.data.values || []).filter(r => r[0] && r[0].trim()).length;

  return { cardFilled, cashFilled };
}

// ── Write a bill row into the sheet ──────────────────────────────────────────
async function writeBillRow(sheets, spreadsheetId, tabName, bill, isCard, rowOffset) {
  // rowOffset: 0-based offset within the card or cash data section
  let sheetRow; // 1-indexed row number for A1 notation
  if (isCard) {
    sheetRow = 18 + rowOffset; // card rows: 18, 19
  } else {
    sheetRow = 25 + rowOffset; // cash rows: 25, 26, ...53
  }

  // Columns: B=date, C=description, H=receipt_nr, L=amount
  // We use separate ranges for the columns since they're not contiguous
  const dateVal    = formatDateForSheet(bill.date);
  const descVal    = bill.description || '';
  const receiptVal = bill.receipt_nr || '';
  const amountVal  = bill.amount !== null && bill.amount !== undefined ? bill.amount : '';

  // Write B (date) and C (description) together
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!B${sheetRow}:C${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[dateVal, descVal]] },
  });

  // Write H (receipt nr)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!H${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[receiptVal]] },
  });

  // Write L (amount)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!L${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[amountVal]] },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const auth   = getAuth();
  const drive  = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // Load processed log
  const processed = loadProcessed();

  // List files in Bills folder
  console.log('Fetching files from Bills folder...');
  const listRes = await drive.files.list({
    q: `'${BILLS_FOLDER_ID}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'name',
  });

  const files = (listRes.data.files || []).filter(f => {
    const name = f.name.toLowerCase();
    return name.endsWith('.pdf') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
  });

  if (files.length === 0) {
    console.log('No bill files found in Bills folder.');
    return;
  }

  console.log(`Found ${files.length} bill file(s).`);

  // Group bills by month tab after reading
  const billsByTab = {}; // { "Jul 2026": [ { bill, isCard }, ... ] }

  for (const file of files) {
    if (processed[file.id]) {
      console.log(`  Skipping (already processed): ${file.name}`);
      continue;
    }

    console.log(`\nReading: ${file.name}`);

    // Download file content
    let fileBuffer;
    try {
      const dlRes = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      fileBuffer = Buffer.from(dlRes.data);
    } catch (err) {
      console.error(`  Failed to download ${file.name}:`, err.message);
      continue;
    }

    // Determine MIME type
    let mimeType = file.mimeType;
    if (mimeType === 'application/octet-stream') {
      const ext = file.name.split('.').pop().toLowerCase();
      mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    }

    // Extract bill data with Gemini
    const bill = await readBillWithGemini(fileBuffer, mimeType, file.name);
    if (!bill) {
      console.error(`  Could not extract data from ${file.name} — skipping`);
      continue;
    }

    console.log(`  Date: ${bill.date}, Merchant: ${bill.description}, Receipt: ${bill.receipt_nr}, Amount: ${bill.amount}, Payment: ${bill.payment_method}`);

    const tabName = monthTabFromDate(bill.date);
    if (!tabName) {
      console.warn(`  Could not determine month for date "${bill.date}" — skipping`);
      continue;
    }

    const isCard = bill.payment_method === 'card' || bill.payment_method === 'upi';

    if (!billsByTab[tabName]) billsByTab[tabName] = { card: [], cash: [] };
    if (isCard) {
      billsByTab[tabName].card.push({ bill, fileId: file.id, fileName: file.name });
    } else {
      billsByTab[tabName].cash.push({ bill, fileId: file.id, fileName: file.name });
    }
  }

  // Now write to sheet, tab by tab
  for (const [tabName, { card: cardBills, cash: cashBills }] of Object.entries(billsByTab)) {
    console.log(`\nWriting to tab "${tabName}" — ${cardBills.length} card, ${cashBills.length} cash bill(s)`);

    // Find or create tab
    await findOrCreateTab(sheets, TEMPLATE_SHEET_ID, tabName);

    // Get how many rows already filled
    const { cardFilled, cashFilled } = await getFilledRows(sheets, TEMPLATE_SHEET_ID, tabName);
    console.log(`  Existing rows: ${cardFilled} card, ${cashFilled} cash`);

    const CARD_MAX = CARD_DATA_END - CARD_DATA_START; // 2
    const CASH_MAX = CASH_DATA_END - CASH_DATA_START; // 29

    // Write card bills
    let cardOffset = cardFilled;
    for (const { bill, fileId, fileName } of cardBills) {
      if (cardOffset >= CARD_MAX) {
        console.warn(`  Card section full (${CARD_MAX} rows max) — writing "${fileName}" to cash section instead`);
        // Overflow to cash
        if (cashFilled + (cashBills.length) < CASH_MAX) {
          cashBills.push({ bill, fileId, fileName });
        } else {
          console.warn(`  Cash section also full — skipping "${fileName}"`);
        }
        continue;
      }
      await writeBillRow(sheets, TEMPLATE_SHEET_ID, tabName, bill, true, cardOffset);
      console.log(`  [Card row ${18 + cardOffset}] ${bill.description} — ${bill.amount}`);
      cardOffset++;
      processed[fileId] = { fileName, date: bill.date, processedAt: new Date().toISOString() };
      saveProcessed(processed);
    }

    // Write cash bills
    let cashOffset = cashFilled;
    for (const { bill, fileId, fileName } of cashBills) {
      if (cashOffset >= CASH_MAX) {
        console.warn(`  Cash section full (${CASH_MAX} rows max) — skipping "${fileName}"`);
        continue;
      }
      await writeBillRow(sheets, TEMPLATE_SHEET_ID, tabName, bill, false, cashOffset);
      console.log(`  [Cash row ${25 + cashOffset}] ${bill.description} — ${bill.amount}`);
      cashOffset++;
      processed[fileId] = { fileName, date: bill.date, processedAt: new Date().toISOString() };
      saveProcessed(processed);
    }
  }

  console.log('\nAll done! Open the sheet:');
  console.log(`https://docs.google.com/spreadsheets/d/${TEMPLATE_SHEET_ID}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
