// Manually mark a checklist task as done for an employee.
// Usage: node src/markTask.js <employeeId> <taskId>
//   e.g. node src/markTask.js EMP001 t15

const fs   = require('fs');
const path = require('path');

const EMPLOYEES_PATH = path.join(__dirname, '..', 'employees.json');
const STATE_DIR      = path.join(__dirname, '..');

const [,, employeeId, taskId] = process.argv;

if (!employeeId || !taskId) {
  console.error('Usage: node src/markTask.js <employeeId> <taskId>');
  console.error('  e.g. node src/markTask.js EMP001 t15');
  process.exit(1);
}

const stateFile = path.join(STATE_DIR, `state-${employeeId}.json`);

if (!fs.existsSync(stateFile)) {
  console.error(`No state file found for ${employeeId} (expected state-${employeeId}.json).`);
  process.exit(1);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (e) {
  console.error(`Failed to parse state file: ${e.message}`);
  process.exit(1);
}

if (!state.checklist) {
  console.error(`State file for ${employeeId} has no checklist.`);
  process.exit(1);
}

// Find the task across all phases
let found = false;
for (const [phaseKey, phase] of Object.entries(state.checklist)) {
  if (phase.tasks && phase.tasks[taskId] !== undefined) {
    if (phase.tasks[taskId].done) {
      console.log(`Task ${taskId} is already marked done in ${phaseKey}.`);
    } else {
      phase.tasks[taskId].done = true;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      console.log(`Marked ${taskId} as done for ${employeeId} (phase: ${phaseKey}).`);
    }
    found = true;
    break;
  }
}

if (!found) {
  console.error(`Task "${taskId}" not found in checklist for ${employeeId}.`);
  console.error('Run "npm run list-employees" to see the employee ID, then check the checklist structure.');
  process.exit(1);
}
