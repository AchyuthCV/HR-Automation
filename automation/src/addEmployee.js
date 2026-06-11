// Interactive CLI to add a new employee to employees.json
// Usage: node src/addEmployee.js  (or: npm run add-employee)

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const EMPLOYEES_PATH = path.join(__dirname, '..', 'employees.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

async function main() {
  console.log('\n=== Add New Employee ===\n');

  const employeeId    = await ask('Employee ID (e.g. EMP002): ');
  const name          = await ask('Full Name: ');
  const personalEmail = await ask('Personal Email: ');
  const officialEmail = await ask('Official Email (leave blank if not yet created): ');
  const doj           = await ask('Date of Joining (YYYY-MM-DD): ');
  const driveFolderId = await ask('Google Drive Folder ID: ');
  const recruiterEmail = await ask('Recruiter Email: ');
  const managerEmail  = await ask('Manager Email: ');
  const itEmail       = await ask('IT Email: ');

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
