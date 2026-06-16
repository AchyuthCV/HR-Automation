const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');

// Lazy — only instantiated when GEMINI_API_KEY is present, so module load never crashes
let _genAI = null;
function getGenAI() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

// Document type → verification prompt
const VERIFICATION_PROMPTS = {
  aadhaar: `You are verifying an Aadhaar card document. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "Aadhaar Card",
  "checks": {
    "legible": true/false,
    "nameVisible": true/false,
    "aadhaarNumberVisible": true/false,
    "photoVisible": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL four checks pass.`,

  pan: `You are verifying a PAN card document. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "PAN Card",
  "checks": {
    "legible": true/false,
    "nameVisible": true/false,
    "panNumberVisible": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL three checks pass.`,

  offerLetter: `You are verifying a signed offer letter. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "Offer Letter",
  "checks": {
    "signed": true/false,
    "candidateNameVisible": true/false,
    "dateVisible": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL three checks pass.`,

  meetingScreenshot: `You are verifying a meeting screenshot to confirm attendance. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "Meeting Screenshot",
  "checks": {
    "meetingEvident": true/false,
    "employeeNameInParticipants": true/false,
    "dateVisible": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL three checks pass.`,

  passportPhoto: `You are verifying a passport-size photograph for HR records. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "Passport Size Photo",
  "checks": {
    "faceVisible": true/false,
    "plainBackground": true/false,
    "imageNotBlurry": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL three checks pass.`,

  payslip: `You are verifying a payslip or salary slip document. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "Payslip",
  "checks": {
    "legible": true/false,
    "employeeNameVisible": true/false,
    "salaryAmountVisible": true/false,
    "monthYearVisible": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL four checks pass.`,

  relievingLetter: `You are verifying a relieving letter or experience letter from a previous employer. Check ALL of the following and respond with a JSON object:
{
  "valid": true/false,
  "docType": "Relieving Letter",
  "checks": {
    "legible": true/false,
    "employeeNameVisible": true/false,
    "companyNameVisible": true/false,
    "signedOrStamped": true/false
  },
  "failureReasons": ["list any failed checks in plain English"],
  "summary": "one sentence summary"
}
Only set valid=true if ALL four checks pass.`,
};

// Map filename keywords to document types
function detectDocType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('aadhaar') || lower.includes('aadhar') || lower.includes('uid')) return 'aadhaar';
  if (lower.includes('pan') || lower.includes('pancard') || lower.includes('pan_card')) return 'pan';
  if (lower.includes('offer') || lower.includes('appointment') || lower.includes('offer_letter')) return 'offerLetter';
  if (lower.includes('meeting') || lower.includes('screenshot') || lower.includes('induction') || lower.includes('intro')) return 'meetingScreenshot';
  if (lower.includes('passport') || lower.includes('photo') || lower.includes('headshot') || lower.includes('profile')) return 'passportPhoto';
  if (lower.includes('payslip') || lower.includes('pay_slip') || lower.includes('salary') || lower.includes('salary_slip')) return 'payslip';
  if (lower.includes('relieving') || lower.includes('relieve') || lower.includes('experience') || lower.includes('relieving_letter')) return 'relievingLetter';
  return null;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB — enough for any ID/offer document

// Download a Drive file to a temp path, return { tempPath, mimeType }
async function downloadDriveFile(auth, fileId, mimeType) {
  const drive = google.drive({ version: 'v3', auth });

  // Check file size before downloading to prevent disk exhaustion
  const meta = await drive.files.get({ fileId, fields: 'size,mimeType' }).catch(() => null);
  if (meta && meta.data.size && parseInt(meta.data.size) > MAX_FILE_BYTES) {
    throw new Error(`File exceeds maximum allowed size (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB). Please upload a smaller file.`);
  }

  const tmpPath = path.join(os.tmpdir(), `hr_auto_${fileId}_${Date.now()}`);

  // Google Docs/Slides need export; binary files use direct download
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'stream' }
    );
    await streamToFile(res.data, tmpPath);
    return { tempPath: tmpPath, downloadMime: 'application/pdf' };
  }

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await streamToFile(res.data, tmpPath);
  return { tempPath: tmpPath, downloadMime: mimeType };
}

function streamToFile(stream, filePath) {
  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(filePath);
    stream.pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
    stream.on('error', reject);
  });
}

// Convert downloaded file to base64 and pick the right media type for Gemini
function fileToBase64(filePath, mimeType) {
  const data = fs.readFileSync(filePath);
  if (data.length === 0) throw new Error(`File is empty: ${filePath}`);
  const base64 = data.toString('base64');
  // Gemini vision accepts: image/jpeg, image/png, image/gif, image/webp, application/pdf
  const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  const mediaType = supported.includes(mimeType) ? mimeType : 'application/pdf';
  return { base64, mediaType };
}

// Retry helper for Gemini quota / rate-limit errors (429 / RESOURCE_EXHAUSTED)
async function callWithRetry(fn, maxRetries = 4) {
  let delay = 10000; // start at 10s
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message && (
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('RESOURCE_EXHAUSTED')
      );
      if (is429 && attempt < maxRetries) {
        // Try to parse retryDelay from error message
        const retryMatch = err.message.match(/"retryDelay":"(\d+)s"/);
        const waitMs = retryMatch ? parseInt(retryMatch[1]) * 1000 + 2000 : delay;
        console.warn(`[Gemini] Quota hit — waiting ${Math.round(waitMs / 1000)}s before retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

// Core verification function — returns { valid, docType, checks, failureReasons, summary }
async function verifyDocument(auth, fileId, filename, mimeType) {
  const docType = detectDocType(filename);
  if (!docType) {
    return {
      valid: false,
      docType: 'Unknown',
      checks: {},
      failureReasons: [`Could not determine document type from filename: "${filename}". Please rename the file to include: aadhaar, pan, offer, or meeting.`],
      summary: 'Unknown document type.',
    };
  }

  const genAI = getGenAI();
  if (!genAI) {
    console.warn(`[Verify] GEMINI_API_KEY not set — skipping verification for ${filename}. Mark manually via /mark-task.`);
    return {
      valid: false,
      docType,
      checks: {},
      failureReasons: ['Gemini API key not configured — document requires manual review.'],
      summary: 'Verification skipped: GEMINI_API_KEY not set.',
    };
  }

  let tempPath = null;
  try {
    const { tempPath: tp, downloadMime } = await downloadDriveFile(auth, fileId, mimeType);
    tempPath = tp;
    const { base64, mediaType } = fileToBase64(tp, downloadMime);

    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result_raw = await callWithRetry(() => model.generateContent([
      VERIFICATION_PROMPTS[docType],
      { inlineData: { data: base64, mimeType: mediaType } },
    ]));

    const raw = result_raw.response.text().trim();
    // Extract JSON from the response (model may wrap it in markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Gemini returned non-JSON response: ' + raw);
    const result = JSON.parse(jsonMatch[0]);
    console.log(`[Verify] ${filename} → valid=${result.valid} | ${result.summary}`);

    return result;
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

// Verify all documents in an employee's folder and return a results map
async function verifyAllDocuments(auth, folderFiles) {
  const results = {};
  for (const file of folderFiles) {
    const docType = detectDocType(file.name);
    if (!docType) continue; // skip unrecognised files silently
    console.log(`[Verify] Checking ${file.name} (${file.id})`);
    results[file.name] = await verifyDocument(auth, file.id, file.name, file.mimeType);
  }
  return results;
}

module.exports = { verifyDocument, verifyAllDocuments, detectDocType };
