// Interactive CLI to add a new employee to employees.json
// Usage: node src/addEmployee.js  (or: npm run add-employee)

const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const EMPLOYEES_PATH = path.join(__dirname, '..', 'employees.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOJ_RE   = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

async function askEmail(label, allowBlank = false) {
  while (true) {
    const val = await ask(`${label}: `);
    if (allowBlank && val === '') return val;
    if (EMAIL_RE.test(val)) return val;
    console.log('  Invalid email. Please enter a valid address (e.g. name@domain.com).');
  }
}

async function askDoj() {
  while (true) {
    const val = await ask('Date of Joining (YYYY-MM-DD): ');
    if (DOJ_RE.test(val) && !isNaN(new Date(val).getTime())) return val;
    console.log('  Invalid date. Use YYYY-MM-DD format (e.g. 2026-08-01).');
  }
}

async function askRequired(label) {
  while (true) {
    const val = await ask(`${label}: `);
    if (val.length > 0) return val;
    console.log('  This field is required.');
  }
}

async function validateDriveFolderId(folderId) {
  try {
    const { getAuthClient } = require('./driveWatcher');
    const { google } = require('googleapis');
    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    await drive.files.get({ fileId: folderId, fields: 'id, name, mimeType' });
    return true;
  } catch (err) {
    if (err.message && err.message.includes('token.json not found')) {
      // Auth not set up yet — skip validation silently
      return true;
    }
    return false;
  }
}

async function askDriveFolderId() {
  while (true) {
    const val = await ask('Google Drive Folder ID: ');
    if (!val) { console.log('  This field is required.'); continue; }

    process.stdout.write('  Validating folder access... ');
    const ok = await validateDriveFolderId(val);
    if (ok) {
      console.log('OK');
      return val;
    }
    console.log('FAILED');
    console.log('  Cannot access that Drive folder. Check:');
    console.log('  1. The ID is correct (from the folder URL: /folders/<ID>)');
    console.log('  2. The folder is shared with your Google account');
    console.log('  3. Run "npm run auth" first if you have not authenticated yet');
    const retry = await ask('  Try a different ID? (yes/no): ');
    if (retry.toLowerCase() !== 'yes') return val; // allow override
  }
}

async function main() {
  console.log('\n=== Add New Employee ===\n');

  const employeeId    = await askRequired('Employee ID (e.g. EMP002)');
  const name          = await askRequired('Full Name');
  const personalEmail = await askEmail('Personal Email');
  const officialEmail = await askEmail('Official Email (leave blank if not yet created)', true);
  const doj           = await askDoj();
  const driveFolderId = await askDriveFolderId();
  const recruiterEmail = await askEmail('Recruiter Email');
  const managerEmail  = await askEmail('Manager Email');
  const itEmail       = await askEmail('IT Email');

  rl.close();

  // Load existing employees
  let employees = [];
  if (fs.existsSync(EMPLOYEES_PATH)) {
    try {
      employees = JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf8'));
    } catch (err) {
      console.error('Error reading employees.json:', err.message);
      process.exit(1);
    }
  }

  // Check for duplicate employeeId
  if (employees.some(e => e.employeeId === employeeId)) {
    console.error(`\nError: Employee ID "${employeeId}" already exists in employees.json.`);
    process.exit(1);
  }

  // Build employee object
  const employee = {
    employeeId,
    name,
    personalEmail,
    officialEmail: officialEmail || '',
    doj,
    driveFolderId,
    contacts: {
      recruiterEmail,
      managerEmail,
      itEmail,
    },
  };

  employees.push(employee);

  // Write back
  try {
    fs.writeFileSync(EMPLOYEES_PATH, JSON.stringify(employees, null, 2));
  } catch (err) {
    console.error('Error writing employees.json:', err.message);
    process.exit(1);
  }

  console.log(`\n✓ Employee ${name} (${employeeId}) added to employees.json`);
  console.log('  Restart the engine (npm start) to begin onboarding.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  rl.close();
  process.exit(1);
});
