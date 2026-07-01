// One-shot script: fire every email template to the correct test addresses
// New Joinee → achyuthcv2020@gmail.com
// Manager    → achyuth.cv@aletheatech.com
// IT         → kingdemon7686@gmail.com
// HR/Recruiter → achyuthcv2020@gmail.com (already in .env)
// Usage: node src/testSendEmails.js

require('dotenv').config();
const {
  sendPreOnboardingForm,
  sendDocumentRejection,
  sendDocumentReminder,
  sendNoResponseAlert,
  sendOfficialEmailCreationRequest,
  sendOfficialEmailAccessTest,
  sendAssetAllocationRequest,
  sendITAssetRequest,
  sendAdminSeatAllocationRequest,
  sendBGVRequest,
  sendVerificationReport,
  sendHRInductionConfirmation,
  sendInductionCalendarInvite,
  sendProjectIntroInvite,
  sendCatchupXLSEmail,
  send25DayCatchupEmail,
  send30DayTechnicalReview,
  sendPeriodicReviewReminder,
  sendReviewSummaryRequest,
  sendPreProbationReminder,
  sendPhaseCompletionSummary,
  sendNoReplyEscalation,
} = require('./emailSender');

const JOINEE  = 'achyuthcv2020@gmail.com';
const MANAGER = 'achyuth.cv@aletheatech.com';
const IT      = 'kingdemon7686@gmail.com';
const HR      = process.env.HR_EMAIL;
const RECRUITER = 'achyuthcv2020@gmail.com';

const employee = {
  employeeId:    'EMP007',
  name:          'Achyuth C.V',
  personalEmail: JOINEE,
  officialEmail: JOINEE,
  doj:           '2026-07-01',
  isFresher:     false,
  driveFolderId: process.env.EMPLOYEE_DRIVE_FOLDER_ID || '',
  officeLocation: 'Bangalore',
  assetRequired:  'Laptop',
  designation:    'Software Engineer',
  team:           'Engineering',
  projectIntroSheetId: null,
  contacts: {
    recruiterEmail: RECRUITER,
    managerEmail:   MANAGER,
    managerName:    'Achyuth Manager',
    itEmail:        IT,
    itPersonName:   'King Demon',
  },
};

async function run() {
  const results = [];

  async function fire(label, fn) {
    try {
      await fn();
      console.log(`✅  ${label}`);
      results.push({ label, ok: true });
    } catch (err) {
      console.error(`❌  ${label} — ${err.message}`);
      results.push({ label, ok: false, err: err.message });
    }
    await new Promise(r => setTimeout(r, 1200)); // small gap between sends
  }

  // ── Emails to New Joinee ────────────────────────────────────────────────────
  await fire('1. Pre-Onboarding Form → Joinee', () => sendPreOnboardingForm(employee));
  await fire('2. Document Rejection → Joinee', () => sendDocumentRejection(employee, 'Aadhaar Card', 'Document is blurry and not legible'));
  await fire('3. Document Reminder #1 → Joinee', () => sendDocumentReminder(employee, 'Aadhaar Card', 1, 'Document is blurry'));
  await fire('3. Document Reminder #3 (Final) → Joinee + Recruiter', () => sendDocumentReminder(employee, 'Aadhaar Card', 3, 'Document is blurry'));
  await fire('6. Official Email Access Test → Joinee', () => sendOfficialEmailAccessTest(employee));
  await fire('11. HR Induction Details → Joinee + Recruiter + Manager', () => sendInductionCalendarInvite(employee));
  await fire('14. Project Intro Invite → Joinee + Manager + Recruiter', () => sendProjectIntroInvite(employee, 'https://docs.google.com/spreadsheets/d/example'));
  await fire('16. Feedback Form + 25-Day Catchup Notice → Joinee', async () => {
    const { sendEmail } = require('./emailSender');
    const feedbackFormLink = process.env.EMPLOYEE_FEEDBACK_FORM_LINK;
    const formSection = feedbackFormLink
      ? `<p><a href="${feedbackFormLink}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;">Employee Feedback Form</a></p>`
      : `<p>The feedback form link will be shared by HR.</p>`;
    await sendEmail({
      to: employee.officialEmail || employee.personalEmail,
      subject: `Employee Feedback Form — ${process.env.COMPANY_NAME}`,
      html: `
        <p>Dear ${employee.name},</p>
        <p>You've been with us for 25 days! Please take a moment to fill in the employee feedback form:</p>
        ${formSection}
        <p>You also have a <strong>25-Day Catchup Call</strong> scheduled on <strong>26 Jul 2026 at 11:00 AM IST</strong> with your HR/Recruiter. Please check your calendar for the invite.</p>
        <p>Regards,<br/>HR Team, ${process.env.COMPANY_NAME}</p>
      `,
    });
  });

  // ── Emails to Manager ───────────────────────────────────────────────────────
  await fire('7. Asset & Seat Allocation Request → Manager', () => sendAssetAllocationRequest(employee, MANAGER));
  await fire('18. 30-Day Project Review → Manager + Joinee', () => send30DayTechnicalReview(employee));

  // ── Emails to IT ────────────────────────────────────────────────────────────
  await fire('8. IT Asset Request → IT', () => sendITAssetRequest(employee, IT, { officeLocation: 'Bangalore', itPersonName: 'King Demon' }));

  // ── Emails to Recruiter ─────────────────────────────────────────────────────
  await fire('4. 24h No-Response Alert → Recruiter', () => sendNoResponseAlert(employee, RECRUITER));
  await fire('9. BGV Initiation Request → Recruiter', () => sendBGVRequest(employee, RECRUITER));
  await fire('10. Document Verification Report → Recruiter', () => sendVerificationReport(employee, {
    'Aadhaar Card':       { valid: true,  summary: 'Name and number match' },
    'PAN Card':           { valid: true,  summary: 'PAN extracted successfully' },
    'Degree Certificate': { valid: false, summary: 'Document unclear — re-upload needed' },
  }));
  await fire('12. HR Induction Confirmation Request → Recruiter', () => sendHRInductionConfirmation(employee, RECRUITER));
  await fire('17. 25-Day Catchup Notification → HR + Recruiter', () => send25DayCatchupEmail(employee));
  await fire('19. 60-Day Review Reminder → Recruiter + Manager', () => sendPeriodicReviewReminder(employee, RECRUITER, MANAGER, 60));
  await fire('20. 90-Day Review Reminder → Recruiter + Manager', () => sendPeriodicReviewReminder(employee, RECRUITER, MANAGER, 90));
  await fire('21. Review Summary Request (60-Day) → Recruiter + Manager', () => sendReviewSummaryRequest(employee, 60));
  await fire('21. Review Summary Request (90-Day) → Recruiter + Manager', () => sendReviewSummaryRequest(employee, 90));

  // ── Emails to HR ────────────────────────────────────────────────────────────
  await fire('5. Create Official Email & Greythr → HR', () => sendOfficialEmailCreationRequest(employee));
  await fire('13. Seat Allocation Confirmation → HR/Admin', () => sendAdminSeatAllocationRequest(employee));
  await fire('22. Pre-Probation Verification → HR + Manager', () => sendPreProbationReminder(employee, MANAGER));
  await fire('23. Phase Completion Summary → HR', () => sendPhaseCompletionSummary(employee, 'Phase 2 — Document Verification', ['Aadhaar verified', 'PAN verified', 'Offer letter verified']));
  await fire('24. 48h No-Reply Escalation → HR', () => sendNoReplyEscalation(employee, 'Reporting Manager', MANAGER));

  // ── Summary ─────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n── Done: ${passed} sent, ${failed} failed ──`);
  if (failed > 0) {
    results.filter(r => !r.ok).forEach(r => console.log(`   ❌ ${r.label}: ${r.err}`));
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
