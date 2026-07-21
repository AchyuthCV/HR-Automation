// ============================================================
// Alethea Billing Engine — Google Apps Script
// Embedded in each employee's copy of the Expense Sheet
//
// Menu: Billing > Process New Bills
//
// Flow:
//   1. Reads Drive folder ID from config cell
//   2. Reads PDFs from that folder → sends to Gemini for extraction
//   3. Reads CC bank alert emails (ICICI format) from billing.ai inbox
//   4. Appends NEW bills only (delta) to Card or Cash section
//   5. Tracks processed file/email IDs in hidden "Processed" tab
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
// Set your Gemini API key here (get one from https://aistudio.google.com/app/apikey)
var GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';
var GEMINI_MODEL   = 'gemini-3.1-flash-lite';
var BILLING_EMAIL  = 'billing.ai@aletheatech.com';

// Sheet layout (1-indexed, as seen in the sheet)
// Card section data rows: 18 to 19  (columns B,C,D,E,F,G,H,I,J,K,L)
// Cash section data rows: 25 to 53  (columns B,C,D,E,F,G,H,I,J,K,L)
// Columns: B=Date, C=Description, D=TransactionID, E=ReceiptNr(?), F=ExpenseType, G=CostCategory, H=AssetYN, I–K unused, L=Amount
// For Card: B=Date, C=Description, D=TransactionID, H=ReceiptNr, L=Amount
// For Cash: B=Date, C=Description, H=ReceiptNr, L=Amount

var CARD_START_ROW = 18;  // first card data row (1-indexed)
var CARD_END_ROW   = 19;  // last card data row (inclusive)
var CASH_START_ROW = 25;  // first cash data row
var CASH_END_ROW   = 54;  // last cash data row

// Config cell: where employee pastes their Bills folder ID
var CONFIG_SHEET   = 'Config';
var FOLDER_ID_CELL = 'B2';

// Hidden tracking tab
var PROCESSED_SHEET = 'Processed';

// ── MENU ────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Billing')
    .addItem('Process New Bills', 'processBills')
    .addItem('Setup Config Sheet', 'setupConfigSheet')
    .addToUi();
}

// ── SETUP ───────────────────────────────────────────────────
function setupConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName(CONFIG_SHEET);
  if (!config) {
    config = ss.insertSheet(CONFIG_SHEET);
  }
  config.getRange('A1').setValue('Setting');
  config.getRange('B1').setValue('Value');
  config.getRange('A2').setValue('Bills Drive Folder ID');
  config.getRange('A3').setValue('Your Name');
  config.getRange('A4').setValue('Your Employee ID');
  config.getRange('A1:B4').setFontWeight('bold');

  // Hide if needed — keep visible so employee can fill it
  SpreadsheetApp.getUi().alert(
    'Config sheet created!\n\n' +
    'Please fill in:\n' +
    '  B2 = Your Bills Drive Folder ID\n' +
    '  B3 = Your Name\n' +
    '  B4 = Your Employee ID\n\n' +
    'Then click Billing > Process New Bills.'
  );
}

// ── MAIN ENTRY POINT ─────────────────────────────────────────
function processBills() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Read folder ID from config
  var configSheet = ss.getSheetByName(CONFIG_SHEET);
  if (!configSheet) {
    SpreadsheetApp.getUi().alert('Please run "Billing > Setup Config Sheet" first.');
    return;
  }
  var folderId = configSheet.getRange(FOLDER_ID_CELL).getValue().toString().trim();
  if (!folderId) {
    SpreadsheetApp.getUi().alert('Please enter your Bills Drive Folder ID in Config!B2.');
    return;
  }

  // Ensure processed tracking tab exists
  ensureProcessedSheet(ss);

  var processed = loadProcessed(ss);
  var addedCount = 0;
  var skippedCount = 0;
  var errors = [];

  // ── 1. Process PDF/image receipts from Drive folder ─────────
  try {
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFiles();

    while (files.hasNext()) {
      var file = files.next();
      var fileId = file.getId();
      var fileName = file.getName();
      var mimeType = file.getMimeType();

      // Only process PDFs and images
      if (!isSupportedFile(mimeType, fileName)) continue;

      if (processed[fileId]) {
        skippedCount++;
        continue;
      }

      Logger.log('Reading receipt: ' + fileName);

      try {
        var bill = extractBillWithGemini(file, mimeType);
        if (!bill) {
          errors.push('Could not read: ' + fileName);
          continue;
        }

        Logger.log('Extracted: ' + JSON.stringify(bill));

        var tabName = getMonthTab(bill.date);
        if (!tabName) {
          errors.push('No valid date in: ' + fileName);
          continue;
        }

        var tab = findOrCreateTab(ss, tabName);
        var isCard = (bill.payment_method === 'card' || bill.payment_method === 'upi');
        var written = appendBillRow(tab, bill, isCard, null);

        if (written) {
          markProcessed(ss, fileId, fileName, bill.date, 'drive');
          processed[fileId] = true;
          addedCount++;
        } else {
          errors.push('Section full for: ' + fileName);
        }
      } catch (e) {
        errors.push('Error on ' + fileName + ': ' + e.message);
        Logger.log('Error: ' + e.message);
      }
    }
  } catch (e) {
    errors.push('Drive folder error: ' + e.message);
  }

  // ── 2. Process CC bank alert emails ─────────────────────────
  try {
    var ccBills = readCCBankEmails(processed);
    for (var i = 0; i < ccBills.length; i++) {
      var cc = ccBills[i];
      try {
        var tabName = getMonthTab(cc.date);
        if (!tabName) continue;

        var tab = findOrCreateTab(ss, tabName);
        // CC transactions go to Card section with transaction ID
        var written = appendBillRow(tab, cc, true, cc.transactionRef);

        if (written) {
          markProcessed(ss, cc.emailId, 'CC:' + cc.merchant, cc.date, 'email');
          processed[cc.emailId] = true;
          addedCount++;
        }
      } catch (e) {
        errors.push('Error on CC email: ' + e.message);
      }
    }
  } catch (e) {
    errors.push('Gmail error: ' + e.message);
    Logger.log('Gmail error: ' + e.message);
  }

  // ── Done: show summary ───────────────────────────────────────
  var msg = 'Done!\n\nAdded: ' + addedCount + ' bill(s)\nSkipped (already processed): ' + skippedCount;
  if (errors.length > 0) {
    msg += '\n\nWarnings:\n' + errors.join('\n');
  }
  SpreadsheetApp.getUi().alert(msg);
}

// ── TEST FUNCTION — run this from Apps Script to check API key ──
function testGeminiKey() {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;
  var payload = {
    contents: [{ parts: [{ text: 'Reply with just the word: OK' }] }]
  };
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  SpreadsheetApp.getUi().alert('Gemini response:\n\n' + response.getContentText().slice(0, 500));
}

// ── GEMINI PDF EXTRACTION ────────────────────────────────────
function extractBillWithGemini(file, mimeType) {
  var fileBytes = file.getBlob().getBytes();
  var b64 = Utilities.base64Encode(fileBytes);

  var prompt = 'You are reading a receipt or bill. Extract the following fields.\n\n' +
    'Return ONLY valid JSON, no markdown, no extra text:\n' +
    '{\n' +
    '  "date": "YYYY-MM-DD or null if not found",\n' +
    '  "description": "Short merchant name only, max 4 words",\n' +
    '  "receipt_nr": "Receipt or invoice number as printed, or null",\n' +
    '  "amount": "Total amount paid as a number (no currency symbol), or null",\n' +
    '  "payment_method": "card or upi or cash or unknown"\n' +
    '}\n\n' +
    'Rules:\n' +
    '- date: use the date printed on the receipt\n' +
    '- description: merchant/store name only, short\n' +
    '- receipt_nr: bill/receipt/invoice number on the document, null if absent\n' +
    '- amount: the grand total paid\n' +
    '- payment_method: look for CARD, UPI, CASH, GPay, PhonePe, Credit, Debit, Online. UPI = card.';

  var payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: b64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0 }
  };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var json = JSON.parse(response.getContentText());

  if (!json.candidates || !json.candidates[0]) {
    Logger.log('Gemini returned no candidates: ' + response.getContentText().slice(0, 300));
    return null;
  }

  var text = json.candidates[0].content.parts[0].text.trim();
  // Strip markdown fences
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    return JSON.parse(text);
  } catch (e) {
    Logger.log('Gemini parse error: ' + text.slice(0, 200));
    return null;
  }
}

// ── CC BANK EMAIL READING ────────────────────────────────────
// Reads ICICI Bank transaction alert emails forwarded to billing.ai@aletheatech.com
// Email format:
//   From: credit_cards@icici.bank.in (or forwarded from employee)
//   Body: "transaction of INR 350.00 on Jun 09, 2026 at 05:06:18. Info: MERCHANT NAME."
function readCCBankEmails(processed) {
  var bills = [];

  // Search for ICICI bank transaction alerts (forwarded to this inbox)
  // Since GAS runs as the sheet owner, it reads the owner's Gmail
  // Employees forward their CC alerts to billing.ai@aletheatech.com
  // The script reads billing.ai's inbox via Gmail service
  var query = 'subject:"Transaction alert for your ICICI Bank Credit Card" in:inbox';
  var threads = GmailApp.search(query, 0, 100);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var emailId = msg.getId();

      if (processed[emailId]) continue;

      var body = msg.getPlainBody();
      var bill = parseICICIAlertEmail(body, emailId);
      if (bill) {
        bills.push(bill);
      }
    }
  }

  return bills;
}

// Parse ICICI Bank CC alert email body
// "Your ICICI Bank Credit Card XX8001 has been used for a transaction of INR 350.00 on Jun 09, 2026 at 05:06:18. Info: MELTING CAKES L L P."
function parseICICIAlertEmail(body, emailId) {
  // Extract amount
  var amountMatch = body.match(/transaction of INR\s+([\d,]+\.?\d*)/i);
  if (!amountMatch) return null;
  var amount = parseFloat(amountMatch[1].replace(/,/g, ''));

  // Extract date
  var dateMatch = body.match(/on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+at/i);
  if (!dateMatch) return null;
  var dateStr = dateMatch[1]; // e.g. "Jun 09, 2026"
  var date = parseDateString(dateStr);
  if (!date) return null;

  // Extract merchant name
  var merchantMatch = body.match(/Info:\s+([^\n\.]+)/i);
  var merchant = merchantMatch ? merchantMatch[1].trim() : 'CC Transaction';
  // Clean up merchant — title case it
  merchant = toTitleCase(merchant);

  // Extract card last 4
  var cardMatch = body.match(/Card\s+XX(\d{4})/i);
  var cardRef = cardMatch ? 'XX' + cardMatch[1] : '';

  return {
    emailId: emailId,
    date: date,
    description: merchant,
    receipt_nr: null,
    amount: amount,
    payment_method: 'card',
    transactionRef: cardRef   // goes into Transaction ID column for card entries
  };
}

// ── TAB / SHEET HELPERS ──────────────────────────────────────

// Returns "Jul 2026" from "2026-07-09"
function getMonthTab(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getFullYear();
}

// Find tab by name; if not found, duplicate the most recent month tab
function findOrCreateTab(ss, tabName) {
  var tab = ss.getSheetByName(tabName);
  if (tab) return tab;

  // Find a month tab to duplicate
  var sheets = ss.getSheets();
  var monthPattern = /^[A-Z][a-z]{2} \d{4}$/;
  var sourceTab = null;
  for (var i = sheets.length - 1; i >= 0; i--) {
    if (monthPattern.test(sheets[i].getName())) {
      sourceTab = sheets[i];
      break;
    }
  }

  if (sourceTab) {
    // Duplicate and rename
    var newTab = sourceTab.copyTo(ss);
    newTab.setName(tabName);
    // Clear data rows
    newTab.getRange('B' + CARD_START_ROW + ':L' + CARD_END_ROW).clearContent();
    newTab.getRange('B' + CASH_START_ROW + ':L' + CASH_END_ROW).clearContent();
    return newTab;
  }

  // Fallback: create blank sheet
  return ss.insertSheet(tabName);
}

// Append a bill row to the card or cash section of a tab
// Returns true if written, false if section full
function appendBillRow(tab, bill, isCard, transactionId) {
  var startRow = isCard ? CARD_START_ROW : CASH_START_ROW;
  var endRow   = isCard ? CARD_END_ROW   : CASH_END_ROW;
  var maxRows  = endRow - startRow + 1;

  // Find first empty row in section (check col B for date)
  var colBRange = tab.getRange('B' + startRow + ':B' + endRow);
  var values = colBRange.getValues();
  var insertAt = -1;
  for (var i = 0; i < values.length; i++) {
    if (!values[i][0] || values[i][0].toString().trim() === '') {
      insertAt = startRow + i;
      break;
    }
  }

  if (insertAt === -1) {
    // Section full — try extending by 1 row if card section
    if (isCard) {
      // Insert a row at end of card section and use it
      tab.insertRowAfter(endRow);
      CARD_END_ROW = endRow + 1; // extend in memory for this run
      insertAt = endRow + 1;
    } else {
      return false; // cash section full
    }
  }

  var dateVal   = formatDate(bill.date);
  var descVal   = bill.description || '';
  var receiptNr = bill.receipt_nr || '';
  var amountVal = (bill.amount !== null && bill.amount !== undefined) ? bill.amount : '';
  var txnId     = transactionId || '';

  // Write: B=date, C=description
  tab.getRange('B' + insertAt).setValue(dateVal);
  tab.getRange('C' + insertAt).setValue(descVal);

  if (isCard) {
    // D = Transaction ID (for CC bank entries)
    if (txnId) tab.getRange('D' + insertAt).setValue(txnId);
    // H = Receipt Nr
    tab.getRange('H' + insertAt).setValue(receiptNr);
  } else {
    // H = Receipt Nr (cash)
    tab.getRange('H' + insertAt).setValue(receiptNr);
  }

  // L = Amount
  tab.getRange('L' + insertAt).setValue(amountVal);

  return true;
}

// ── PROCESSED TRACKING ───────────────────────────────────────

function ensureProcessedSheet(ss) {
  var sheet = ss.getSheetByName(PROCESSED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROCESSED_SHEET);
    sheet.getRange('A1:D1').setValues([['ID', 'Name', 'Date', 'Source']]);
    sheet.hideSheet();
  }
  return sheet;
}

// Returns object: { fileId: true, ... } for all processed IDs
function loadProcessed(ss) {
  var sheet = ss.getSheetByName(PROCESSED_SHEET);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var result = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) result[data[i][0].toString()] = true;
  }
  return result;
}

function markProcessed(ss, id, name, date, source) {
  var sheet = ss.getSheetByName(PROCESSED_SHEET);
  if (!sheet) sheet = ensureProcessedSheet(ss);
  sheet.appendRow([id, name, date, source]);
}

// ── UTILITIES ────────────────────────────────────────────────

function isSupportedFile(mimeType, fileName) {
  var supported = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (supported.indexOf(mimeType) !== -1) return true;
  var lower = (fileName || '').toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.jpg') ||
         lower.endsWith('.jpeg') || lower.endsWith('.png');
}

// "2026-07-09" → "09 Jul 2026"
function formatDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var day = d.getDate().toString().padStart(2, '0');
  return day + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

// "Jun 09, 2026" → "2026-06-09"
function parseDateString(str) {
  try {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      var y = d.getFullYear();
      var mo = (d.getMonth() + 1).toString().padStart(2, '0');
      var dy = d.getDate().toString().padStart(2, '0');
      return y + '-' + mo + '-' + dy;
    }
  } catch (e) {}
  return null;
}

// "MELTING CAKES L L P" → "Melting Cakes L L P"
function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}
