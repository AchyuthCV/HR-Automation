/**
 * Re-run Gemini extraction on already-uploaded education documents for an employee.
 * Scans Marksheet_10th, Marksheet_12th, Degree_Certificate, Postgrad_Certificate
 * subfolders in their Drive folder, extracts data, saves to state.
 * Usage: node src/reExtractDocs.js EMP007
 */
require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const employeeId = process.argv[2];
if (!employeeId) { console.error('Usage: node src/reExtractDocs.js <employeeId>'); process.exit(1); }

const { google } = require('googleapis');
const { decrypt, encrypt, isEncryptionEnabled } = require('./encryption');
const { extractDocumentData } = require('./documentVerifier');

const STATE_DIR = path.join(__dirname, '..');
const stateFile = path.join(STATE_DIR, `state-${employeeId}.json`);
if (!fs.existsSync(stateFile)) { console.error(`No state file: ${stateFile}`); process.exit(1); }

const raw   = fs.readFileSync(stateFile, 'utf8');
const data  = JSON.parse(raw);
const state = data.ciphertext ? JSON.parse(decrypt(raw)) : data;

const empList = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'employees.json'), 'utf8'));
const empBase = empList.find(e => e.employeeId === employeeId);
if (!empBase) { console.error(`${employeeId} not found in employees.json`); process.exit(1); }

const driveFolderId = state.driveFolderId || empBase.driveFolderId;
if (!driveFolderId) { console.error('No driveFolderId found'); process.exit(1); }

function buildAuth() {
  const creds = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'credentials.json')));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const oAuth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'token.json'))));
  return oAuth2;
}

// Subfolder name → docType key used by extractDocumentData
const TARGET_FOLDERS = {
  'Marksheet_10th':      'marksheet10th',
  'Marksheet_12th':      'marksheet12th',
  'Degree_Certificate':  'degreeCertificate',
  'Postgrad_Certificate':'postgradCertificate',
};

async function run() {
  const auth  = buildAuth();
  const drive = google.drive({ version: 'v3', auth });

  state.extractedData = state.extractedData || {};

  for (const [folderName, docType] of Object.entries(TARGET_FOLDERS)) {
    // Find the subfolder inside the employee's Drive folder
    const folderRes = await drive.files.list({
      q: `'${driveFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });
    if (!folderRes.data.files.length) {
      console.log(`  [skip] ${folderName} — subfolder not found`);
      continue;
    }
    const subFolderId = folderRes.data.files[0].id;

    // List files inside that subfolder
    const filesRes = await drive.files.list({
      q: `'${subFolderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
    });
    if (!filesRes.data.files.length) {
      console.log(`  [skip] ${folderName} — no files uploaded`);
      continue;
    }

    for (const file of filesRes.data.files) {
      console.log(`\n[extract] ${folderName}/${file.name} (${docType})`);
      try {
        const extracted = await extractDocumentData(auth, file.id, file.name, file.mimeType);
        if (extracted && extracted.fields && Object.keys(extracted.fields).length) {
          state.extractedData[docType] = extracted.fields;
          console.log(`  ✅ Extracted:`, extracted.fields);
        } else {
          console.log(`  ⚠️  Gemini returned no fields`);
        }
      } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
      }
      break; // Only process the first file per subfolder
    }
  }

  // Save updated state
  const plain   = JSON.stringify(state, null, 2);
  const payload = isEncryptionEnabled() ? encrypt(plain) : plain;
  fs.writeFileSync(stateFile, payload);
  console.log(`\n✅ State saved. extractedData keys: ${Object.keys(state.extractedData).join(', ')}`);
  console.log('Now run: node src/testInfoSheet.js', employeeId);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
