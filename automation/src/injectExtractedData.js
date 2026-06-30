/**
 * Dev utility: inject mock education extracted data into an employee's state file
 * so you can test sheet filling without uploading real documents.
 * Usage: node src/injectExtractedData.js EMP007
 */
require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const employeeId = process.argv[2];
if (!employeeId) { console.error('Usage: node src/injectExtractedData.js <employeeId>'); process.exit(1); }

const { decrypt, encrypt, isEncryptionEnabled } = require('./encryption');

const STATE_DIR = path.join(__dirname, '..');
const stateFile = path.join(STATE_DIR, `state-${employeeId}.json`);
if (!fs.existsSync(stateFile)) { console.error(`No state file: ${stateFile}`); process.exit(1); }

const raw  = fs.readFileSync(stateFile, 'utf8');
const data = JSON.parse(raw);
const state = data.ciphertext ? JSON.parse(decrypt(raw)) : data;

// Inject mock education data
state.extractedData = state.extractedData || {};
state.extractedData.marksheet10th = {
  board: 'CBSE',
  yearOfCompletion: '2015',
  totalMarks: '92%',
  schoolName: 'Demo High School',
};
state.extractedData.marksheet12th = {
  board: 'CBSE',
  specialization: 'Science (PCM)',
  yearOfCompletion: '2017',
  totalMarks: '88%',
  schoolName: 'Demo Senior Secondary School',
};
state.extractedData.degreeCertificate = {
  degree: 'B.E. Computer Science',
  specialization: 'Computer Science & Engineering',
  yearOfCompletion: '2021',
  totalMarks: '8.4 CGPA',
  collegeName: 'Demo Engineering College',
};

const plain = JSON.stringify(state, null, 2);
const payload = isEncryptionEnabled() ? encrypt(plain) : plain;
fs.writeFileSync(stateFile, payload);

console.log(`✅ Injected mock education data into state-${employeeId}.json`);
console.log('Now run: node src/testInfoSheet.js', employeeId);
