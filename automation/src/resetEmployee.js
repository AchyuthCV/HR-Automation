// Reset one employee's onboarding state so they can be re-onboarded from scratch.
// Clears state-<ID>.json but keeps them in employees.json.
// Usage: npm run reset-employee

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

  const employees = JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf8'));
  if (employees.length === 0) {
    console.log('No employees registered.');
    process.exit(0);
  }

  console.log('\nRegistered employees:');
  employees.forEach(e => console.log(`  ${e.employeeId} — ${e.name} (DOJ: ${e.doj})`));

  const id = await ask('\nEmployee ID to reset: ');
  const emp = employees.find(e => e.employeeId === id);
  if (!emp) {
    console.error(`Employee "${id}" not found.`);
    rl.close();
    process.exit(1);
  }

  console.log(`\nThis will delete state-${id}.json so the engine restarts ${emp.name}'s onboarding from scratch.`);
  console.log('The employee stays in employees.json. Their activity log is NOT deleted.');
  const confirm = await ask('Continue? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  const stateFile = path.join(STATE_DIR, `state-${id}.json`);
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log(`Deleted state-${id}.json`);
  } else {
    console.log(`No state file found for ${id} — already clean.`);
  }

  console.log(`\nDone. Restart the engine to re-onboard ${emp.name} from the beginning.`);
  rl.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});
