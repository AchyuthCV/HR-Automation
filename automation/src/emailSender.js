const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendEmail({ to, subject, html }) {
  const info = await transporter.sendMail({
    from: `"${process.env.COMPANY_NAME} HR Automation" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
  console.log(`[Email] Sent to ${to} — ${subject} (${info.messageId})`);
  return info;
}

// Template 1: Pre-onboarding form sent to new joinee
async function sendPreOnboardingForm(employee) {
  const { name, personalEmail, formLink, doj } = employee;
  return sendEmail({
    to: personalEmail,
    subject: `Welcome to ${process.env.COMPANY_NAME}! Action Required — Pre-Onboarding Form`,
    html: `
      <p>Dear ${name},</p>
      <p>We are delighted to welcome you to <strong>${process.env.COMPANY_NAME}</strong>!</p>
      <p>Your Date of Joining is <strong>${doj}</strong>. To ensure a smooth onboarding, please complete the pre-onboarding form and upload your documents (Aadhaar card, PAN card, signed offer letter, passport-size photo).</p>
      <p><a href="${formLink}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;">Complete Pre-Onboarding Form</a></p>
      <p>Please submit within <strong>24 hours</strong> of receiving this email.</p>
      <p>Looking forward to having you on board!<br/>HR Team, ${process.env.COMPANY_NAME}</p>
    `,
  });
}

// Template 2: Document verification failed — ask employee to re-upload
async function sendDocumentRejection(employee, docType, reason) {
  const { name, personalEmail } = employee;
  return sendEmail({
    to: personalEmail,
    subject: `Action Required — Please Re-upload Your ${docType}`,
    html: `
      <p>Dear ${name},</p>
      <p>Thank you for submitting your documents. Unfortunately we could not verify your <strong>${docType}</strong>:</p>
      <blockquote style="border-left:4px solid #e53935;padding:8px 16px;color:#555;">${reason}</blockquote>
      <p>Please upload a clear, legible copy to the designated Google Drive folder within <strong>24 hours</strong>.</p>
      <ul>
        <li>File must be clearly legible (not blurry or cropped)</li>
        <li>All required fields must be fully visible</li>
        <li>Accepted formats: PDF, JPG, PNG</li>
      </ul>
      <p>Regards,<br/>HR Team, ${process.env.COMPANY_NAME}</p>
    `,
  });
}

// Template 3: 24-hour no-response alert to recruiter
async function sendNoResponseAlert(employee, recruiterEmail) {
  const { name, employeeId, personalEmail } = employee;
  return sendEmail({
    to: recruiterEmail,
    subject: `ALERT — ${name} (${employeeId}) Has Not Responded in 24 Hours`,
    html: `
      <p>Hi,</p>
      <p>This is an automated alert. <strong>${name}</strong> (ID: ${employeeId}) has not responded to the pre-onboarding request for more than <strong>24 hours</strong>.</p>
      <p><strong>Personal Email:</strong> ${personalEmail}</p>
      <p>Please follow up directly with the candidate to ensure they complete the required steps before their Date of Joining.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 4: Request to HR to create official email ID + greythr login
async function sendOfficialEmailCreationRequest(employee) {
  const { name, employeeId, doj, personalEmail } = employee;
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `Action Required — Create Official Email & Greythr Login for ${name} (${employeeId})`,
    html: `
      <p>Hi HR Team,</p>
      <p>Pre-onboarding documents for <strong>${name}</strong> have been verified. Please create the following before DOJ on <strong>${doj}</strong>:</p>
      <ol>
        <li>Official ${process.env.COMPANY_NAME} email ID</li>
        <li>Greythr login credentials</li>
      </ol>
      <ul>
        <li>Name: ${name}</li>
        <li>Employee ID: ${employeeId}</li>
        <li>Personal Email: ${personalEmail}</li>
        <li>Date of Joining: ${doj}</li>
      </ul>
      <p>Please reply with the official email ID and Greythr confirmation so we can proceed.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 5: Asset allocation request to reporting manager
async function sendAssetAllocationRequest(employee, managerEmail) {
  const { name, employeeId, doj } = employee;
  return sendEmail({
    to: managerEmail,
    subject: `Action Required — Asset & Seat Allocation for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>New team member <strong>${name}</strong> (ID: ${employeeId}) is joining on <strong>${doj}</strong>. Please advise on:</p>
      <ol>
        <li>Asset allocation (laptop, peripherals, etc.)</li>
        <li>Office location / work site</li>
        <li>Supervisor / buddy allocation</li>
      </ol>
      <p>Please reply with the above details so we can coordinate with IT and Admin.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 6: IT asset request
async function sendITAssetRequest(employee, itEmail, assetDetails) {
  const { name, employeeId, doj } = employee;
  return sendEmail({
    to: itEmail,
    subject: `Action Required — IT Asset Setup for ${name} (${employeeId}) joining ${doj}`,
    html: `
      <p>Hi IT Team,</p>
      <p>Please arrange IT assets and access for <strong>${name}</strong> (ID: ${employeeId}) joining on <strong>${doj}</strong>:</p>
      <ul>
        <li>Asset Type: ${assetDetails.assetType || 'As per standard allocation'}</li>
        <li>Office Location: ${assetDetails.officeLocation || 'TBD'}</li>
        <li>Access Card: Required</li>
        <li>System Access: Email, Internal Tools</li>
      </ul>
      <p>Please reply confirming asset allocation and access card issuance.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 7: BGV initiation request to recruiter
async function sendBGVRequest(employee, recruiterEmail) {
  const { name, employeeId, doj } = employee;
  return sendEmail({
    to: recruiterEmail,
    subject: `Action Required — Initiate BGV for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>Please initiate the Background Verification (BGV) for <strong>${name}</strong> (ID: ${employeeId}) joining on <strong>${doj}</strong>.</p>
      <p>Once initiated, please share the BGV report or confirmation by replying to this email.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 8: HR induction attendance confirmation
async function sendHRInductionConfirmation(employee, recruiterEmail) {
  const { name, employeeId } = employee;
  return sendEmail({
    to: recruiterEmail,
    subject: `Confirmation Required — HR Induction for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>Please confirm that the HR induction session for <strong>${name}</strong> (ID: ${employeeId}) has been completed.</p>
      <p>Reply with <strong>"Confirmed"</strong> to mark this step complete in the onboarding checklist.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 9: 30-day catchup reminder
async function send30DayCatchupReminder(employee, recruiterEmail, managerEmail) {
  const { name, employeeId } = employee;
  return sendEmail({
    to: `${recruiterEmail}, ${managerEmail}`,
    subject: `Reminder — 30-Day Catchup Call for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>The <strong>30-day catchup call</strong> for <strong>${name}</strong> (ID: ${employeeId}) is due.</p>
      <p>Please conduct the call and fill in the catchup XLS shared earlier. Key areas to cover:</p>
      <ul>
        <li>Onboarding experience</li>
        <li>Understanding of role and responsibilities</li>
        <li>Challenges or concerns</li>
        <li>Initial performance feedback</li>
      </ul>
      <p>Reply with the filled XLS or a brief summary once done.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 10: 60/90-day review reminder
async function sendPeriodicReviewReminder(employee, recruiterEmail, managerEmail, dayMark) {
  const { name, employeeId } = employee;
  return sendEmail({
    to: `${recruiterEmail}, ${managerEmail}`,
    subject: `Reminder — ${dayMark}-Day Review for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>The <strong>${dayMark}-day review</strong> for <strong>${name}</strong> (ID: ${employeeId}) is due.</p>
      <p>Please schedule and conduct the review call. After the call:</p>
      <ol>
        <li>Update the project intro sheet with outcomes</li>
        <li>Reply to this email confirming the review was completed</li>
      </ol>
      <p>If the call cannot happen soon, reply with the new proposed date.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 11: Pre-probation reminder (5 months)
async function sendPreProbationReminder(employee, managerEmail) {
  const { name, employeeId } = employee;
  return sendEmail({
    to: `${process.env.HR_EMAIL}, ${managerEmail}`,
    subject: `Action Required — Pre-Probation Verification for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p><strong>${name}</strong> (ID: ${employeeId}) is approaching the end of their probation period.</p>
      <p>Please complete the pre-probation verification:</p>
      <ul>
        <li>Performance review during probation</li>
        <li>Feedback from reporting manager</li>
        <li>Decision: confirm or extend probation</li>
        <li>Communicate decision to employee</li>
      </ul>
      <p>Reply once the verification is complete.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 12: Phase completion summary to HR
async function sendPhaseCompletionSummary(employee, phase, completedTasks) {
  const { name, employeeId } = employee;
  const taskList = completedTasks.map(t => `<li>${t}</li>`).join('');
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `Onboarding Update — ${phase} Completed for ${name} (${employeeId})`,
    html: `
      <p>Hi HR Team,</p>
      <p>The following onboarding phase has been completed for <strong>${name}</strong> (ID: ${employeeId}):</p>
      <p><strong>Phase: ${phase}</strong></p>
      <ul>${taskList}</ul>
      <p>The system will now automatically proceed to the next phase.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 13: Document verification report to recruiter (t9)
async function sendVerificationReport(employee, verificationResults) {
  const { name, employeeId, contacts } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;

  const rows = Object.entries(verificationResults).map(([docType, res]) => {
    const statusIcon = res.valid ? '&#10003;' : '&#10007;';
    const statusColor = res.valid ? '#2e7d32' : '#c62828';
    const statusLabel = res.valid ? 'PASSED' : 'FAILED';
    const summary = res.summary || (res.valid ? 'Verification successful' : 'Verification failed');
    return `
      <tr>
        <td style="padding:8px 12px;border:1px solid #ddd;">${docType}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;color:${statusColor};font-weight:bold;">${statusIcon} ${statusLabel}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;color:#555;">${summary}</td>
      </tr>`;
  }).join('');

  return sendEmail({
    to: recruiterEmail,
    subject: `Document Verification Report — ${name}`,
    html: `
      <p>Hi,</p>
      <p>Here is the automated document verification report for <strong>${name}</strong> (ID: ${employeeId}):</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <thead>
          <tr style="background:#1a73e8;color:#fff;">
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;">Document</th>
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;">Status</th>
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;">Summary</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p style="margin-top:16px;">If any document has <strong>FAILED</strong>, the system has already sent a re-upload request to the candidate. Please follow up if no response is received within 24 hours.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 14: HR induction calendar invite — email to employee + recruiter (t27)
async function sendInductionCalendarInvite(employee) {
  const { name, employeeId, doj, officialEmail, personalEmail, contacts } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;
  const toEmail = [officialEmail || personalEmail, recruiterEmail].filter(Boolean).join(', ');
  const displayDoj = doj || 'Your Date of Joining';

  return sendEmail({
    to: toEmail,
    subject: `HR Induction Details — ${name} — DOJ ${displayDoj}`,
    html: `
      <p>Dear ${name} and Team,</p>
      <p>Your HR induction has been scheduled for your Date of Joining. Please find the details below:</p>
      <table style="border-collapse:collapse;width:480px;font-family:Arial,sans-serif;font-size:14px;margin:16px 0;">
        <tr style="background:#f5f5f5;">
          <td style="padding:8px 14px;border:1px solid #ddd;font-weight:bold;">Date</td>
          <td style="padding:8px 14px;border:1px solid #ddd;">${displayDoj} (Date of Joining)</td>
        </tr>
        <tr>
          <td style="padding:8px 14px;border:1px solid #ddd;font-weight:bold;">Time</td>
          <td style="padding:8px 14px;border:1px solid #ddd;">9:30 AM onwards</td>
        </tr>
        <tr style="background:#f5f5f5;">
          <td style="padding:8px 14px;border:1px solid #ddd;font-weight:bold;">Location</td>
          <td style="padding:8px 14px;border:1px solid #ddd;">Office / As communicated by your recruiter</td>
        </tr>
        <tr>
          <td style="padding:8px 14px;border:1px solid #ddd;font-weight:bold;">Conducted by</td>
          <td style="padding:8px 14px;border:1px solid #ddd;">Recruiter / HR Team</td>
        </tr>
        <tr style="background:#f5f5f5;">
          <td style="padding:8px 14px;border:1px solid #ddd;font-weight:bold;">Topics covered</td>
          <td style="padding:8px 14px;border:1px solid #ddd;">Company policies, tools, culture, team introductions</td>
        </tr>
      </table>
      <p><strong>${name}</strong> — please be present at the office by <strong>9:30 AM</strong> on your Date of Joining. The recruiter will conduct the induction covering company policies, tools, and culture.</p>
      <p><strong>Recruiter</strong> — please confirm attendance by replying to this email once the induction is complete.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 15: Project intro meeting invite + intro sheet to manager + employee (t29/t31)
async function sendProjectIntroInvite(employee) {
  const { name, employeeId, doj, officialEmail, personalEmail, contacts } = employee;
  const managerEmail = contacts && contacts.managerEmail;
  const toEmail = [officialEmail || personalEmail, managerEmail].filter(Boolean).join(', ');
  const role = employee.role || employee.designation || 'New Joiner';

  return sendEmail({
    to: toEmail,
    subject: `Project Intro Meeting — ${name}`,
    html: `
      <p>Hi,</p>
      <p>A project introduction meeting has been scheduled for <strong>${name}</strong> (ID: ${employeeId}) during their first week at <strong>${process.env.COMPANY_NAME}</strong>.</p>
      <p>Please coordinate with your manager to confirm the exact date and time. The meeting should cover initial project context, goals, and introductions to the team.</p>
      <h3 style="margin-top:20px;font-family:Arial,sans-serif;">Project Intro Sheet</h3>
      <p style="color:#555;font-size:13px;">Please fill in the highlighted columns before the meeting.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;margin:12px 0;">
        <thead>
          <tr style="background:#1a73e8;color:#fff;">
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;">Field</th>
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;">Employee Name</td>
            <td style="padding:8px 12px;border:1px solid #ddd;">${name}</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;">Role / Designation</td>
            <td style="padding:8px 12px;border:1px solid #ddd;">${role}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;">Reporting Manager</td>
            <td style="padding:8px 12px;border:1px solid #ddd;">${managerEmail || 'As assigned'}</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;">Date of Joining</td>
            <td style="padding:8px 12px;border:1px solid #ddd;">${doj}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#e65100;">Key Projects</td>
            <td style="padding:8px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(To be filled by manager before meeting)</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#e65100;">Initial Goals</td>
            <td style="padding:8px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(To be filled by manager before meeting)</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#e65100;">Buddy / Mentor Name</td>
            <td style="padding:8px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(To be assigned)</td>
          </tr>
        </tbody>
      </table>
      <p style="color:#e65100;font-size:13px;"><strong>Action:</strong> Please fill in the <em>Key Projects</em>, <em>Initial Goals</em>, and <em>Buddy Name</em> columns and reply before the meeting.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 16: 30-day catchup tracker — inline HTML table to recruiter + manager (t40)
async function sendCatchupXLSEmail(employee) {
  const { name, employeeId, contacts } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;
  const managerEmail = contacts && contacts.managerEmail;
  const toEmail = [recruiterEmail, managerEmail].filter(Boolean).join(', ');

  return sendEmail({
    to: toEmail,
    subject: `30-Day Catchup Tracker — ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>The 30-day catchup call for <strong>${name}</strong> (ID: ${employeeId}) is approaching. Please use the tracker below during or after the call and <strong>reply with the filled details</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;margin:16px 0;">
        <thead>
          <tr style="background:#1a73e8;color:#fff;">
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;width:40%;">Category</th>
            <th style="padding:10px 12px;border:1px solid #1a73e8;text-align:left;">Notes / Feedback</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px 12px;border:1px solid #ddd;font-weight:bold;">Onboarding experience</td>
            <td style="padding:10px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(Fill after call)</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:10px 12px;border:1px solid #ddd;font-weight:bold;">Understanding of role</td>
            <td style="padding:10px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(Fill after call)</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;border:1px solid #ddd;font-weight:bold;">Challenges faced</td>
            <td style="padding:10px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(Fill after call)</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:10px 12px;border:1px solid #ddd;font-weight:bold;">Initial performance feedback</td>
            <td style="padding:10px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(Fill after call)</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;border:1px solid #ddd;font-weight:bold;">Action items</td>
            <td style="padding:10px 12px;border:1px solid #ddd;color:#999;font-style:italic;">(Fill after call)</td>
          </tr>
        </tbody>
      </table>
      <p>Please fill in the above table and reply to this email once the 30-day catchup call is complete.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 17: Review summary request — replaces "call transcribed" for t43/t46/t49
async function sendReviewSummaryRequest(employee, dayMark) {
  const { name, employeeId, contacts } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;
  const managerEmail = contacts && contacts.managerEmail;
  const toEmail = [recruiterEmail, managerEmail].filter(Boolean).join(', ');

  return sendEmail({
    to: toEmail,
    subject: `${dayMark}-Day Review Summary Request — ${name}`,
    html: `
      <p>Hi,</p>
      <p>The <strong>${dayMark}-day review</strong> for <strong>${name}</strong> (ID: ${employeeId}) is due. Please conduct the review call and reply to this email with a brief summary covering the following points:</p>
      <ol>
        <li><strong>Performance so far</strong> — overall assessment</li>
        <li><strong>Key achievements</strong> — notable contributions or milestones</li>
        <li><strong>Areas of improvement</strong> — feedback on gaps or development needs</li>
        <li><strong>Manager feedback</strong> — reporting manager's overall view</li>
        <li><strong>Next steps</strong> — goals or action items for the next period</li>
      </ol>
      <p style="color:#555;border-left:4px solid #ffa000;padding:8px 16px;background:#fffde7;">
        <strong>Note:</strong> If the call has not happened yet, please reply with a proposed date so the system can follow up accordingly.
      </p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 18: No-reply escalation — sent to HR when a stakeholder hasn't replied in 48h
async function sendNoReplyEscalation(employee, recipientType, originalRecipient) {
  const { name, employeeId } = employee;
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `ESCALATION — No Reply from ${recipientType} for ${name} (${employeeId})`,
    html: `
      <p>Hi HR Team,</p>
      <p>This is an automated escalation notice.</p>
      <p><strong>${recipientType}</strong> (<code>${originalRecipient}</code>) has <strong>not replied</strong> to the automated onboarding request sent <strong>48 hours ago</strong> for <strong>${name}</strong> (ID: ${employeeId}).</p>
      <p>Please follow up manually with <strong>${recipientType}</strong> to ensure the required action is completed before the candidate's onboarding is impacted.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

module.exports = {
  sendEmail,
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
};
