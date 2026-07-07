// fireJoineeEmails.js — fire all new joinee emails to a test address
require('dotenv').config();

const {
  sendPreOnboardingForm,
  sendOfficialEmailAccessTest,
  sendInductionCalendarInvite,
  sendProjectIntroInvite,
  sendJoineeReviewNotification,
  sendJoineeOnboardingComplete,
  sendEmail,
} = require('./src/emailSender');

const TEST_EMAIL = 'achyuthcv2020@gmail.com';

const employee = {
  employeeId: 'EMP001',
  name: 'Achyuth C.V',
  personalEmail: TEST_EMAIL,
  officialEmail: TEST_EMAIL,
  doj: '2026-07-01',
  isFresher: false,
  role: 'Software Engineer',
  department: 'Engineering',
  driveFolderId: process.env.EMPLOYEE_DRIVE_FOLDER_ID,
  contacts: {
    recruiterEmail: TEST_EMAIL,
    managerEmail: TEST_EMAIL,
    itEmail: TEST_EMAIL,
  },
  checklist: {},
  extractedData: {},
  projectIntroSheetUrl: 'https://docs.google.com/spreadsheets/d/demo',
};

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('Firing all new joinee emails to', TEST_EMAIL, '...\n');

  console.log('[1/9] Welcome + pre-onboarding form...');
  await sendPreOnboardingForm(employee);
  await delay(1500);

  console.log('[2/9] Official email access test...');
  await sendOfficialEmailAccessTest(employee);
  await delay(1500);

  console.log('[3/9] HR induction notification...');
  await sendInductionCalendarInvite(employee);
  await delay(1500);

  console.log('[4/9] Project intro notification (no sheet link)...');
  await sendProjectIntroInvite(employee, null);
  await delay(1500);

  console.log('[5/9] Day 25 catchup notification...');
  await sendJoineeReviewNotification(employee, 25);
  await delay(1500);

  console.log('[6/9] Day 25 feedback form...');
  const feedbackFormLink = process.env.EMPLOYEE_FEEDBACK_FORM_LINK;
  const formSection = feedbackFormLink
    ? `<p><a href="${feedbackFormLink}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">Fill Employee Feedback Form</a></p>`
    : `<p style="color:#e65100;">Feedback form link not configured.</p>`;
  await sendEmail({
    to: TEST_EMAIL,
    subject: `Employee Feedback Form — ${process.env.COMPANY_NAME || 'Alethea'}`,
    html: `<p>Hi ${employee.name},</p><p>You have been with us for 25 days! Please take a moment to share your experience so far by filling the feedback form:</p>${formSection}<p>Regards,<br/>${process.env.COMPANY_NAME || 'Alethea'} HR</p>`,
  });
  await delay(1500);

  console.log('[7/9] Day 30 review notification...');
  await sendJoineeReviewNotification(employee, 30);
  await delay(1500);

  console.log('[8/9] Day 60 & 90 review notifications...');
  await sendJoineeReviewNotification(employee, 60);
  await delay(1500);
  await sendJoineeReviewNotification(employee, 90);
  await delay(1500);

  console.log('[9/9] Onboarding complete...');
  await sendJoineeOnboardingComplete(employee);

  console.log('\nAll 9 joinee emails sent! Check achyuthcv2020@gmail.com');
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
