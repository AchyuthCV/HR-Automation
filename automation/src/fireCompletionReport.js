// One-shot: fire the onboarding completion report for an employee.
// Usage: node src/fireCompletionReport.js EMP008
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const { google } = require('googleapis');
const { decrypt } = require('./encryption');
const { sendOnboardingCompletionReport } = require('./emailSender');

const employeeId = process.argv[2];
if (!employeeId) { console.error('Usage: node src/fireCompletionReport.js <employeeId>'); process.exit(1); }

const STATE_DIR = path.join(__dirname, '..');
const stateFile = path.join(STATE_DIR, `state-${employeeId}.json`);
if (!fs.existsSync(stateFile)) { console.error(`No state file for ${employeeId}`); process.exit(1); }

const raw  = fs.readFileSync(stateFile, 'utf8');
const data = JSON.parse(raw);
const state = data.ciphertext ? JSON.parse(decrypt(raw)) : data;

const empList = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'employees.json'), 'utf8'));
const empBase = empList.find(e => e.employeeId === employeeId);
if (!empBase) { console.error(`${employeeId} not found in employees.json`); process.exit(1); }

const employee = { ...empBase, ...state, employeeId };

async function run() {
  console.log(`Sending completion report for ${employee.name} (${employeeId})...`);
  await sendOnboardingCompletionReport(employee);
  console.log('Done. Check HR and recruiter inbox.');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
