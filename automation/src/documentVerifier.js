const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
};

// Map filename keywords to document types
function detectDocType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('aadhaar') || lower.includes('aadhar')) return 'aadhaar';
  if (lower.includes('pan')) return 'pan';
  if (lower.includes('offer') || lower.includes('appointment')) return 'offerLetter';
  if (lower.includes('meeting') || lower.includes('screenshot') || lower.includes('induction')) return 'meetingScreenshot';
  return null;
}

// Download a Drive file to a temp path, return { tempPath, mimeType }
async function downloadDriveFile(auth, fileId, mimeType) {
  const drive = google.drive({ version: 'v3', auth });
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
  const base64 = data.toString('base64');
  // Gemini vision accepts: image/jpeg, image/png, image/gif, image/webp, application/pdf
  const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  const mediaType = supported.includes(mimeType) ? mimeType : 'application/pdf';
  return { base64, mediaType };
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

  let tempPath = null;
  try {
    const { tempPath: tp, downloadMime } = await downloadDriveFile(auth, fileId, mimeType);
    tempPath = tp;
    const { base64, mediaType } = fileToBase64(tp, downloadMime);

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    const result_raw = await model.generateContent([
      VERIFICATION_PROMPTS[docType],
      { inlineData: { data: base64, mimeType: mediaType } },
    ]);

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
