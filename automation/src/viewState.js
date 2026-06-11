// Pretty-print an employee's persisted state file.
// Usage: npm run view-state -- EMP001

const fs   = require('fs');
const path = require('path');

const employeeId = process.argv[2];
if (!employeeId) {
  console.error('Usage: npm run view-state -- <employeeId>');
  console.error('  e.g. npm run view-state -- EMP001');
  process.exit(1);
}

const stateFile = path.join(__dirname, '..', `state-${employeeId}.json`);
if (!fs.existsSync(stateFile)) {
  console.error(`No state file found: state-${employeeId}.json`);
  process.exit(1);
}

try {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  // Summary header
  let total = 0, done = 0;
  for (const phase of Object.values(state.checklist || {})) {
    for (const task of Object.values(phase.tasks || {})) {
      total++;
      if (task.done) done++;
    }
  }
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  console.log(`\n=== State: ${employeeId} ===`);
  console.log(`Progress  : ${done}/${total} tasks (${pct}%)`);
  console.log(`Milestones: ${state.milestonesScheduled ? 'scheduled' : 'not yet scheduled'}`);
  console.log(`Sheet ID  : ${state.statusSheetId || '(none)'}`);

  if (state.verificationResults && Object.keys(state.verificationResults).length > 0) {
    console.log('\nVerification Results:');
    for (const [doc, vr] of Object.entries(state.verificationResults)) {
      console.log(`  ${doc}: ${vr.passed ? 'PASS' : 'FAIL'} — ${vr.reason || ''}`);
    }
  }

  if (state.replyTimerExpiry && Object.keys(state.replyTimerExpiry).length > 0) {
    console.log('\nReply Timer Expiry:');
    for (const [key, ts] of Object.entries(state.replyTimerExpiry)) {
      console.log(`  ${key}: ${ts}`);
    }
  }

  console.log('\nFull JSON:');
  console.log(JSON.stringify(state, null, 2));
} catch (e) {
  console.error('Failed to parse state file:', e.message);
  process.exit(1);
}
