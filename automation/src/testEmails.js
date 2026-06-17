// Test script — sends one of every email template to GMAIL_USER so you can verify
// all templates render correctly in a real inbox.
// Usage: node src/testEmails.js  (or: npm run test-emails)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  sendPreOnboardingForm,
  sendDocumentRejection,
  sendNoResponseAlert,
  sendOfficialEmailCreationRequest,
  sendAssetAllocationRequest,
  sendITAssetRequest,
  sendBGVRequest,
  sendHRInductionConfirmation,
  send30DayCatchupReminder,
  sendPeriodicReviewReminder,
  sendPreProbationReminder,
  sendPhaseCompletionSummary,
  sendVerificationReport,
  sendInductionCalendarInvite,
  sendProjectIntroInvite,
  sendCatchupXLSEmail,
  sendReviewSummaryRequest,
  sendNoReplyEscalation,
} = require('./emailSender');

const { getAuthClient } = require('./driveWatcher');

const testEmail = process.env.GMAIL_USER;

if (!testEmail) {
  console.error('Error: GMAIL_USER is not set in .env');
  process.exit(1);
}

// Build a fake employee — all emails point to GMAIL_USER so everything lands in one inbox
// _auth is injected after Google auth is ready so Drive/Sheets calls work (e.g. catchup XLS)
const employee = {
  employeeId: 'TEST001',
  name: 'Test Employee',
  designation: 'Software Engineer',
  team: 'Test Services Team',
  officeLocation: 'L4 Location',
  personalEmail: testEmail,
  officialEmail: testEmail,
  doj: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  formLink: 'https://example.com/form',
  driveFolderId: process.env.TEST_DRIVE_FOLDER_ID || process.env.EMPLOYEE_DRIVE_FOLDER_ID || null,
  contacts: {
    recruiterEmail: testEmail,
    managerEmail: testEmail,
    itEmail: process.env.IT_EMAIL || testEmail,
    itPersonName: 'IT Team',
  },
};

// Each entry: [label, async fn]
const tests = [
  ['1/19  sendPreOnboardingForm',         () => sendPreOnboardingForm(employee)],
  ['2/19  sendDocumentRejection',         () => sendDocumentRejection(employee, 'Aadhaar Card', 'Document is blurry and Aadhaar number is not visible')],
  ['3/19  sendNoResponseAlert',           () => sendNoResponseAlert(employee, testEmail)],
  ['4/19  sendOfficialEmailCreationRequest', () => sendOfficialEmailCreationRequest(employee)],
  ['5/19  sendAssetAllocationRequest',    () => sendAssetAllocationRequest(employee, testEmail)],
  ['6/19  sendITAssetRequest',            () => sendITAssetRequest(employee, testEmail, { assetType: 'MacBook Pro', officeLocation: 'Bangalore HQ' })],
  ['7/19  sendBGVRequest',                () => sendBGVRequest(employee, testEmail)],
  ['8/19  sendHRInductionConfirmation',   () => sendHRInductionConfirmation(employee, testEmail)],
  ['9/19  send30DayCatchupReminder',      () => send30DayCatchupReminder(employee, testEmail, testEmail)],
  ['10/19 sendPeriodicReviewReminder(60)',() => sendPeriodicReviewReminder(employee, testEmail, testEmail, 60)],
  ['11/19 sendPeriodicReviewReminder(90)',() => sendPeriodicReviewReminder(employee, testEmail, testEmail, 90)],
  ['12/19 sendPreProbationReminder',      () => sendPreProbationReminder(employee, testEmail)],
  ['13/19 sendPhaseCompletionSummary',    () => sendPhaseCompletionSummary(employee, 'Phase 3 — Day of Joining', ['HR induction done', 'IT assets allocated', 'Project intro meeting done'])],
  ['14/19 sendVerificationReport',        () => sendVerificationReport(employee, {
      aadhaar: { valid: true,  summary: 'Aadhaar card is clear and all fields visible' },
      pan:     { valid: false, summary: 'PAN number not visible' },
    })],
  ['15/19 sendInductionCalendarInvite',   () => sendInductionCalendarInvite(employee)],
  ['16/19 sendProjectIntroInvite',        () => sendProjectIntroInvite(employee)],
  ['17/19 sendCatchupXLSEmail',           () => sendCatchupXLSEmail(employee)],
  ['18/19 sendReviewSummaryRequest(30)',  () => sendReviewSummaryRequest(employee, 30)],
  ['19/19 sendNoReplyEscalation',         () => sendNoReplyEscalation(employee, 'IT Team', process.env.IT_EMAIL || testEmail)],
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Inject real Google auth so Drive/Sheets-backed templates (e.g. catchup XLS) work
  try {
    employee._auth = getAuthClient();
    console.log('  Google auth ready — Drive/Sheets templates will create real files');
  } catch (err) {
    console.warn(`  Warning: Google auth failed (${err.message}) — Drive/Sheets templates will skip sheet creation`);
  }

  console.log(`\nSending ${tests.length} test emails to ${testEmail}\n`);
  let sent = 0;

  for (let i = 0; i < tests.length; i++) {
    const [label, fn] = tests[i];
    process.stdout.write(`  Sending ${label} ... `);
    try {
      await fn();
      console.log('OK');
      sent++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
    }
    // 1s gap between sends to avoid rate limits
    if (i < tests.length - 1) {
      await sleep(1000);
    }
  }

  console.log(`\n✓ Sent ${sent}/${tests.length} emails to ${testEmail}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
