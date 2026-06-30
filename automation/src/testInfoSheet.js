/**
 * One-shot test: recreate the AL_DI_HR_018 info sheet for an employee.
 * Usage: node src/testInfoSheet.js EMP007
 *
 * Reads the current state file + employees.json, calls createEmployeeInfoSheet,
 * then prints the sheet URL. Does NOT modify state.
 */
require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const employeeId = process.argv[2];
if (!employeeId) { console.error('Usage: node src/testInfoSheet.js <employeeId>'); process.exit(1); }

const { google }  = require('googleapis');
const { decrypt } = require('./encryption');
const { createEmployeeInfoSheet } = require('./statusTracker');

const STATE_DIR = path.join(__dirname, '..');
const stateFile = path.join(STATE_DIR, `state-${employeeId}.json`);
if (!fs.existsSync(stateFile)) { console.error(`No state file: ${stateFile}`); process.exit(1); }

const raw  = fs.readFileSync(stateFile, 'utf8');
const data = JSON.parse(raw);
const state = data.ciphertext ? JSON.parse(decrypt(raw)) : data;

const empList = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'employees.json'), 'utf8'));
const empBase = empList.find(e => e.employeeId === employeeId);
if (!empBase) { console.error(`${employeeId} not found in employees.json`); process.exit(1); }

// Merge — strip cached sheet ID so a fresh sheet is always created
const employee = { ...empBase, ...state, employeeId };
delete employee.employeeInfoSheetId;

function buildAuth() {
  const creds = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'credentials.json')));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const oAuth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'token.json'))));
  return oAuth2;
}

async function run() {
  const auth = buildAuth();
  console.log(`\nCreating info sheet for ${employeeId} (${employee.name})…`);
  console.log('Extracted data keys:', Object.keys(employee.extractedData || {}).join(', ') || '(none)');

  const url = await createEmployeeInfoSheet(auth, employee);
  console.log('\n✅ Sheet URL:', url);
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
