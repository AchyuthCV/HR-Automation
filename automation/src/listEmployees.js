// List all employees and their current onboarding state.
// Usage: npm run list-employees

const fs = require('fs');
const path = require('path');

const EMPLOYEES_PATH = path.join(__dirname, '..', 'employees.json');
const STATE_DIR = path.join(__dirname, '..');

function loadState(employeeId) {
  const p = path.join(STATE_DIR, `state-${employeeId}.json`);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }
  return null;
}

function countTasks(checklist) {
  let total = 0, done = 0;
  for (const phase of Object.values(checklist || {})) {
    for (const task of Object.values(phase.tasks || {})) {
      total++;
      if (task.done) done++;
    }
  }
  return { total, done };
}

function currentPhase(checklist) {
  for (const phase of Object.values(checklist || {})) {
    if (phase.tasks && Object.values(phase.tasks).some(t => !t.done)) return phase.label;
  }
  return 'Complete';
}

if (!fs.existsSync(EMPLOYEES_PATH)) {
  console.log('No employees.json found. Add employees with: npm run add-employee');
  process.exit(0);
}

const employees = JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf8'));

if (employees.length === 0) {
  console.log('No employees registered.');
  process.exit(0);
}

console.log('\n=== Registered Employees ===\n');
console.log(`${'ID'.padEnd(10)} ${'Name'.padEnd(24)} ${'DOJ'.padEnd(12)} ${'Progress'.padEnd(12)} Phase`);
console.log('─'.repeat(85));

for (const emp of employees) {
  const state = loadState(emp.employeeId);
  const checklist = state ? state.checklist : emp.checklist;
  const { total, done } = countTasks(checklist);
  const pct = total > 0 ? `${done}/${total} (${Math.round(done/total*100)}%)` : 'No state';
  const phase = checklist ? currentPhase(checklist) : '—';
  console.log(
    `${emp.employeeId.padEnd(10)} ${emp.name.padEnd(24)} ${emp.doj.padEnd(12)} ${pct.padEnd(12)} ${phase}`
  );
}
console.log();
