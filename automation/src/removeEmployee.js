// Remove an employee from employees.json and clean up their state files.
// Usage: npm run remove-employee

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const EMPLOYEES_PATH = path.join(__dirname, '..', 'employees.json');
const STATE_DIR      = path.join(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, a => resolve(a.trim())));

async function main() {
  if (!fs.existsSync(EMPLOYEES_PATH)) {
    console.log('No employees.json found.');
    process.exit(0);
  }

  let employees = JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf8'));
  if (employees.length === 0) {
    console.log('No employees registered.');
    process.exit(0);
  }

  console.log('\nRegistered employees:');
  employees.forEach((e, i) => console.log(`  ${i + 1}. ${e.employeeId} — ${e.name} (DOJ: ${e.doj})`));

  const id = await ask('\nEmployee ID to remove: ');
  const idx = employees.findIndex(e => e.employeeId === id);

  if (idx === -1) {
    console.error(`Employee "${id}" not found.`);
    rl.close();
    process.exit(1);
  }

  const emp = employees[idx];
  const confirm = await ask(`Remove ${emp.name} (${emp.employeeId})? This also deletes their state file. (yes/no): `);
  if (confirm.toLowerCase() !== 'yes') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  // Remove from employees.json
  employees.splice(idx, 1);
  fs.writeFileSync(EMPLOYEES_PATH, JSON.stringify(employees, null, 2));
  console.log(`Removed ${emp.name} from employees.json`);

  // Delete per-employee state file
  const stateFile = path.join(STATE_DIR, `state-${id}.json`);
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log(`Deleted state-${id}.json`);
  }

  // Delete activity log
  const logFile = path.join(STATE_DIR, 'logs', `${id}.log`);
  if (fs.existsSync(logFile)) {
    const keepLog = await ask('Keep activity log for audit? (yes/no): ');
    if (keepLog.toLowerCase() !== 'yes') {
      fs.unlinkSync(logFile);
      console.log(`Deleted logs/${id}.log`);
    }
  }

  console.log(`\nDone. Restart the engine if it is running.`);
  rl.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});
