const nodemailer = require('nodemailer');
require('dotenv').config();

// Escape user-controlled strings before embedding in HTML email bodies
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendEmail({ to, subject, html }, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await transporter.sendMail({
        from: `"${process.env.COMPANY_NAME} HR Automation" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
      });
      console.log(`[Email] Sent to ${to} — ${subject} (${info.messageId})`);
      return info;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[Email] Failed after ${retries} attempts — ${subject} to ${to}: ${err.message}`);
        throw err;
      }
      const delay = attempt * 5000;
      console.warn(`[Email] Attempt ${attempt} failed, retrying in ${delay / 1000}s — ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Template 1: Pre-onboarding form sent to new joinee
async function sendPreOnboardingForm(employee) {
  const { name, personalEmail, doj } = employee;
  const formLink = process.env.PREONBOARDING_FORM_LINK || employee.formLink || '#';
  const formSection = formLink === '#'
    ? `<p style="color:#c62828;">⚠️ The pre-onboarding form link has not been configured. Please contact HR directly.</p>`
    : `<p><a href="${esc(formLink)}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;">Complete Pre-Onboarding Form</a></p>`;
  return sendEmail({
    to: personalEmail,
    subject: `Welcome to ${process.env.COMPANY_NAME}! Action Required — Pre-Onboarding Form`,
    html: `
      <p>Dear ${esc(name)},</p>
      <p>We are delighted to welcome you to <strong>${esc(process.env.COMPANY_NAME)}</strong>!</p>
      <p>Your Date of Joining is <strong>${esc(doj)}</strong>. To ensure a smooth onboarding, please complete the pre-onboarding form and upload your documents (Aadhaar card, PAN card, signed offer letter, passport-size photo).</p>
      ${formSection}
      <p>Please submit within <strong>24 hours</strong> of receiving this email.</p>
      <p>Looking forward to having you on board!<br/>HR Team, ${esc(process.env.COMPANY_NAME)}</p>
    `,
  });
}

// Template 2: Document verification failed — ask employee to re-upload
async function sendDocumentRejection(employee, docType, reason) {
  const { name, personalEmail } = employee;
  return sendEmail({
    to: personalEmail,
    subject: `Action Required — Please Re-upload Your ${esc(docType)}`,
    html: `
      <p>Dear ${esc(name)},</p>
      <p>Thank you for submitting your documents. Unfortunately we could not verify your <strong>${esc(docType)}</strong>:</p>
      <blockquote style="border-left:4px solid #e53935;padding:8px 16px;color:#555;">${esc(reason)}</blockquote>
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
    subject: `ALERT — ${esc(name)} (${esc(employeeId)}) Has Not Responded in 24 Hours`,
    html: `
      <p>Hi,</p>
      <p>This is an automated alert. <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) has not responded to the pre-onboarding request for more than <strong>24 hours</strong>.</p>
      <p><strong>Personal Email:</strong> ${esc(personalEmail)}</p>
      <p>Please follow up directly with the candidate to ensure they complete the required steps before their Date of Joining.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 4: Request to HR to create official email ID + greythr login
async function sendOfficialEmailCreationRequest(employee) {
  const { name, employeeId, doj, personalEmail } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `Action Required — Create Official Email & Greythr Login for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi HR Team,</p>
      <p>Pre-onboarding documents for <strong>${esc(name)}</strong> have been verified. Please create the following before DOJ on <strong>${esc(doj)}</strong>:</p>
      <ol>
        <li>Official ${co} email ID</li>
        <li>Greythr login credentials</li>
      </ol>
      <ul>
        <li>Name: ${esc(name)}</li>
        <li>Employee ID: ${esc(employeeId)}</li>
        <li>Personal Email: ${esc(personalEmail)}</li>
        <li>Date of Joining: ${esc(doj)}</li>
      </ul>
      <p>Please reply with the official email ID and Greythr confirmation so we can proceed.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 5: Asset allocation request to reporting manager
async function sendAssetAllocationRequest(employee, managerEmail) {
  const { name, employeeId, doj } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  return sendEmail({
    to: managerEmail,
    subject: `Action Required — Asset & Seat Allocation for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi,</p>
      <p>New team member <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) is joining on <strong>${esc(doj)}</strong>. Please advise on:</p>
      <ol>
        <li>Asset allocation (laptop, peripherals, etc.)</li>
        <li>Office location / work site</li>
        <li>Supervisor / buddy allocation</li>
      </ol>
      <p>Please reply with the above details so we can coordinate with IT and Admin.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 6: IT asset request — matches Alethea format used by HR
async function sendITAssetRequest(employee, itEmail, assetDetails) {
  const { name, doj } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  const designation = employee.designation || employee.role || 'New Joinee';
  const team = employee.team || employee.department || 'the Team';
  const location = (employee.officeLocation) || (assetDetails && assetDetails.officeLocation) || 'Office';
  // itPersonName: prefer employee.contacts, fallback to assetDetails, then generic
  const itPersonName = (employee.contacts && employee.contacts.itPersonName) ||
    (assetDetails && assetDetails.itPersonName) || 'IT Team';

  return sendEmail({
    to: itEmail,
    subject: `IT Asset Request — ${esc(name)} (DOJ: ${esc(doj)})`,
    html: `
      <p>Dear Team,</p>
      <p>
        Candidate <strong>${esc(name)}</strong> (<strong>${esc(designation)}</strong>) is Joining the
        <strong>${esc(team)}</strong> and will be joining us in office (<strong>${esc(location)}</strong>)
        on <strong>${esc(doj)}</strong>.
      </p>
      <p>@${esc(itPersonName)} &nbsp; Request you to advise on the IT Asset.</p>
      <p>Regards,<br/>${co} HR</p>
    `,
  });
}

// Template 7: BGV initiation request to recruiter
async function sendBGVRequest(employee, recruiterEmail) {
  const { name, employeeId, doj } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  return sendEmail({
    to: recruiterEmail,
    subject: `Action Required — Initiate BGV for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi,</p>
      <p>Please initiate the Background Verification (BGV) for <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) joining on <strong>${esc(doj)}</strong>.</p>
      <p>Once initiated, please share the BGV report or confirmation by replying to this email.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 8: HR induction attendance confirmation
async function sendHRInductionConfirmation(employee, recruiterEmail) {
  const { name, employeeId } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  return sendEmail({
    to: recruiterEmail,
    subject: `Confirmation Required — HR Induction for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi,</p>
      <p>Please confirm that the HR induction session for <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) has been completed.</p>
      <p>Reply with <strong>"Confirmed"</strong> to mark this step complete in the onboarding checklist.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 10: 60/90-day review reminder
async function sendPeriodicReviewReminder(employee, recruiterEmail, managerEmail, dayMark) {
  const { name, employeeId } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  return sendEmail({
    to: `${recruiterEmail}, ${managerEmail}`,
    subject: `Reminder — ${dayMark}-Day Review for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi,</p>
      <p>The <strong>${dayMark}-day review</strong> for <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) is due.</p>
      <p>Please schedule and conduct the review call. After the call:</p>
      <ol>
        <li>Update the project intro sheet with outcomes</li>
        <li>Reply to this email confirming the review was completed</li>
      </ol>
      <p>If the call cannot happen soon, reply with the new proposed date.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 11: Pre-probation reminder (5 months)
async function sendPreProbationReminder(employee, managerEmail) {
  const { name, employeeId } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  return sendEmail({
    to: `${process.env.HR_EMAIL}, ${managerEmail}`,
    subject: `Action Required — Pre-Probation Verification for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi,</p>
      <p><strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) is approaching the end of their probation period.</p>
      <p>Please complete the pre-probation verification:</p>
      <ul>
        <li>Performance review during probation</li>
        <li>Feedback from reporting manager</li>
        <li>Decision: confirm or extend probation</li>
        <li>Communicate decision to employee</li>
      </ul>
      <p>Reply to this email with <strong>"Pre-probation verification complete for [Employee ID]"</strong> once done. The system will automatically close this milestone.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 12: Phase completion summary to HR
async function sendPhaseCompletionSummary(employee, phase, completedTasks) {
  const { name, employeeId } = employee;
  const co = esc(process.env.COMPANY_NAME || '');
  const taskList = completedTasks.map(t => `<li>${esc(String(t))}</li>`).join('');
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `Onboarding Update — ${esc(phase)} Completed for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi HR Team,</p>
      <p>The following onboarding phase has been completed for <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}):</p>
      <p><strong>Phase: ${esc(phase)}</strong></p>
      <ul>${taskList}</ul>
      <p>The system will now automatically proceed to the next phase.</p>
      <p>Regards,<br/>${co} HR Automation</p>
    `,
  });
}

// Template 13: Document verification report to recruiter (t9)
async function sendVerificationReport(employee, verificationResults) {
  const { name, employeeId, contacts } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;

  if (!verificationResults || Object.keys(verificationResults).length === 0) {
    console.warn(`[Email] sendVerificationReport skipped for ${name} — no verification results yet`);
    return;
  }

  if (!recruiterEmail) {
    console.warn(`[Email] sendVerificationReport skipped for ${name} — recruiterEmail is not set`);
    return;
  }

  const rows = Object.entries(verificationResults).map(([docType, res]) => {
    const statusIcon = res.valid ? '&#10003;' : '&#10007;';
    const statusColor = res.valid ? '#2e7d32' : '#c62828';
    const statusLabel = res.valid ? 'PASSED' : 'FAILED';
    const summary = res.summary || (res.valid ? 'Verification successful' : 'Verification failed');
    return `
      <tr>
        <td style="padding:8px 12px;border:1px solid #ddd;">${esc(docType)}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;color:${statusColor};font-weight:bold;">${statusIcon} ${esc(statusLabel)}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;color:#555;">${esc(summary)}</td>
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

// Template 14: HR induction calendar invite — email to employee + recruiter + manager (t27)
async function sendInductionCalendarInvite(employee) {
  const { name, employeeId, doj, officialEmail, personalEmail, contacts } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;
  const managerEmail = contacts && contacts.managerEmail;
  const toEmail = [officialEmail || personalEmail, recruiterEmail, managerEmail].filter(Boolean).join(', ');
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
      <p>A calendar invite has been sent to all participants. If the timing does not work, you can <strong>propose a new time</strong> directly from the calendar invite.</p>
      <p><strong>Recruiter</strong> — please confirm attendance by replying to this email once the induction is complete.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 15: Project intro meeting invite + intro sheet to manager + employee (t29/t31)
async function sendProjectIntroInvite(employee, sheetUrl) {
  const { name, employeeId, doj, officialEmail, personalEmail, contacts } = employee;
  const managerEmail = contacts && contacts.managerEmail;
  const recruiterEmail = contacts && contacts.recruiterEmail;
  const toEmail = [officialEmail || personalEmail, managerEmail, recruiterEmail].filter(Boolean).join(', ');

  const sheetSection = sheetUrl
    ? `<p style="margin:16px 0;">
        <a href="${sheetUrl}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">
          Open Project Intro Sheet
        </a>
      </p>
      <p style="color:#555;font-size:13px;">
        <strong>Manager:</strong> Please open the sheet and fill in Key Projects, Initial Goals, Buddy/Mentor, and Team Name before the meeting.<br/>
        <strong>Note:</strong> Employee access to this sheet will be removed after 48 hours — manager and recruiter retain access.
      </p>`
    : `<p style="color:#e65100;font-size:13px;">The project intro sheet could not be created automatically — please contact HR.</p>`;

  return sendEmail({
    to: toEmail,
    subject: `Project Intro Meeting Scheduled — ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>A project introduction meeting has been scheduled for <strong>${name}</strong> (ID: ${employeeId}) at <strong>${process.env.COMPANY_NAME}</strong>.</p>
      <p>The meeting will take place on the day of joining (post-lunch) and will cover initial project context, goals, team introductions, and buddy assignment.</p>
      ${sheetSection}
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 16: 30-day catchup tracker — creates a Google Sheet in Drive + emails link to recruiter + manager (t40)
async function sendCatchupXLSEmail(employee) {
  const { name, employeeId, contacts, driveFolderId } = employee;
  const recruiterEmail = contacts && contacts.recruiterEmail;
  const managerEmail = contacts && contacts.managerEmail;
  const toEmail = [recruiterEmail, managerEmail].filter(Boolean).join(', ');

  // Create catchup tracker Google Sheet matching the actual Alethea template:
  // 4 tabs: Document Version history | Details of New Joinee & Task | Tracking-Month-1/2/3
  let sheetUrl = null;
  if (employee._auth && driveFolderId) {
    try {
      const { google } = require('googleapis');
      const sheets = google.sheets({ version: 'v4', auth: employee._auth });
      const drive = google.drive({ version: 'v3', auth: employee._auth });

      // Create workbook with all 4 tabs up front
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: `New Joinee & Task Tracker — ${name} (${employeeId})` },
          sheets: [
            { properties: { title: 'Document Version history',    index: 0 } },
            { properties: { title: 'Details of New Joinee & Task', index: 1 } },
            { properties: { title: 'Tracking - Month -1',          index: 2 } },
            { properties: { title: 'Tracking - Month -2',          index: 3 } },
            { properties: { title: 'Tracking - Month -3',          index: 4 } },
          ],
        },
      });
      const spreadsheetId = spreadsheet.data.spreadsheetId;
      const tabIds = {};
      for (const s of spreadsheet.data.sheets) {
        tabIds[s.properties.title] = s.properties.sheetId;
      }

      // ── Tab: Details of New Joinee & Task ──────────────────────────────────
      const dojStr = employee.doj || '';
      const teamJoined = employee.team || employee.department || '';
      const reportingManager = (contacts && contacts.managerName) || managerEmail || '';
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "'Details of New Joinee & Task'!A1",
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Details of New Joinee & Task'],
            [`Name: ${name}\nDOJ: ${dojStr}\nTeam Joined: ${teamJoined}\nReporting Manager: ${reportingManager}\nProject Buddy:`],
            ['Key Areas of Responsibilities:\n1.\n2.\n3.'],
            ['Objectives:\n1.\n2.\n3.'],
            ['Task/ Training Schedule:'],
            [],
          ],
        },
      });

      // ── Tab: Tracking rows (same structure for Month -1, -2, -3) ──────────
      const trackingRows = [
        // Row 1: header (merged A1:C1 — just set in A1)
        // Row 2-4: Tasks Assigned block + completion % header
        // Row 5: Lead's Observations | Suggestions headers
        // Rows 6-10: Performance dimensions
        // Rows 11-12: blank spacers
        // Row 13: Filled by Recruiter headers
        // Rows 14-15: Concern questions
        // Row 16: Summary
      ];

      // Month -1: 2 recruiter questions. Month -2 and -3: adds probation question.
      const buildTrackingData = (monthLabel) => {
        const hasProbationQ = monthLabel !== 'Tracking - Month -1';
        const rows = [
          [monthLabel, '', ''],
          ['Tasks Assigned', 'Task/ Training 1: Completion Percentage: Mention percentage only (For example 100% )Proficiency achieved on the tasks completed: Task/ Training 2:', ''],
          ['', '', ''],
          ['', '', ''],
          ['', "Lead's Observations on the tasks assigned", 'Suggestions for improvements from the lead'],
          ['PERSONAL QUALITY\n1.Timely and accurate completion of activities with desired standards\n2.Takes initiative and is innovative\n3.Flexible and effective in taking up new challenges\n4.Response time', '', ''],
          ['TEAMWORK\nCo-operation with other team members', '', ''],
          ['LEADERSHIP\nAbility to plan\nOrganize\nDelegate\nControl', '', ''],
          ['COMMUNICATIONClarity  and Conciseness in one-to-one and group discussions', '', ''],
          ['Ownership & Accountability', '', ''],
          ['', '', ''],
          ['', '', ''],
          ['Filled by Recruiter', 'Filled by Recruiter', ''],
          ['Do you have any other concerns apart from technical output which is impacting the work currently ?', '', ''],
          ['Do you have any concerns on the time taken to complete the assigned tasks/training and/or the quality of the output?', '', ''],
        ];
        if (hasProbationQ) {
          rows.push(['Do you feel the probation will be confirmed or will it be extended ?', '', '']);
        }
        rows.push(['', '', '']);
        rows.push(['Summary', '', '']);
        rows.push(['', '', '']);
        return rows;
      };

      for (const tab of ['Tracking - Month -1', 'Tracking - Month -2', 'Tracking - Month -3']) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tab}'!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: buildTrackingData(tab) },
        });
      }

      // ── Formatting ─────────────────────────────────────────────────────────
      const formatRequests = [];

      // Details tab — title row bold centered
      const detailsId = tabIds['Details of New Joinee & Task'];
      formatRequests.push({
        repeatCell: {
          range: { sheetId: detailsId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: {
            textFormat: { bold: true, fontSize: 12 },
            horizontalAlignment: 'CENTER',
          }},
          fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
        },
      });
      // Details tab — wrap all cells
      formatRequests.push({
        repeatCell: {
          range: { sheetId: detailsId, startRowIndex: 0, endRowIndex: 10 },
          cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
          fields: 'userEnteredFormat(wrapStrategy)',
        },
      });

      // Tracking tabs — header row + performance dimension rows light grey background
      for (const tab of ['Tracking - Month -1', 'Tracking - Month -2', 'Tracking - Month -3']) {
        const sid = tabIds[tab];
        // Tab title row bold centered
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: {
              textFormat: { bold: true, fontSize: 11 },
              horizontalAlignment: 'CENTER',
            }},
            fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
          },
        });
        // Performance dimension rows (rows 6-10, 0-indexed: 5-9) light grey + bold label
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 5, endRowIndex: 10 },
            cell: { userEnteredFormat: {
              backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
              textFormat: { bold: true },
              wrapStrategy: 'WRAP',
            }},
            fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy)',
          },
        });
        // "Filled by Recruiter" row bold
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 12, endRowIndex: 13 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat(textFormat)',
          },
        });
        // Wrap all content rows
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 18 },
            cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
            fields: 'userEnteredFormat(wrapStrategy)',
          },
        });
        // Auto-resize columns A-C
        formatRequests.push({
          autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 3 } },
        });
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: formatRequests },
      });

      // Move into employee's Drive folder
      const fileMeta = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
      const currentParents = (fileMeta.data.parents || []).join(',');
      await drive.files.update({
        fileId: spreadsheetId,
        addParents: driveFolderId,
        removeParents: currentParents,
        fields: 'id, parents',
      });

      // Share with recruiter and manager (edit access)
      const shareWith = [recruiterEmail, managerEmail].filter(Boolean);
      for (const email of [...new Set(shareWith)]) {
        await drive.permissions.create({
          fileId: spreadsheetId,
          requestBody: { type: 'user', role: 'writer', emailAddress: email },
          sendNotificationEmail: false,
        }).catch(() => {});
      }

      sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      console.log(`[Email] Catchup tracker sheet created for ${name}: ${sheetUrl}`);
    } catch (err) {
      console.warn(`[Email] Could not create catchup XLS sheet for ${name}: ${err.message}`);
    }
  }

  const sheetSection = sheetUrl
    ? `<p style="margin:16px 0;"><a href="${sheetUrl}" style="background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">Open New Joinee & Task Tracker</a></p>
       <p style="color:#555;font-size:13px;">The tracker has been saved in ${esc(name)}'s onboarding folder. Please fill in the monthly tracking tabs after each review call.</p>`
    : `<p style="color:#e65100;">The tracker sheet could not be created automatically — please create it manually.</p>`;

  return sendEmail({
    to: toEmail,
    subject: `New Joinee & Task Tracker — ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi,</p>
      <p>Please find the New Joinee & Task Tracker for <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}) below.</p>
      <p>The tracker contains:</p>
      <ul>
        <li><strong>Details of New Joinee & Task</strong> — Employee info, Key Areas of Responsibilities, Objectives, Task/Training Schedule (to be filled by manager)</li>
        <li><strong>Tracking - Month -1/2/3</strong> — Monthly performance tracking with tasks, lead observations, and recruiter feedback sections</li>
      </ul>
      ${sheetSection}
      <p>Please fill in the relevant month tab after each catchup call (30-day, 60-day, and 90-day reviews).</p>
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

  const xlsSection = dayMark === 30 ? `
      <p style="color:#555;border-left:4px solid #1565c0;padding:8px 16px;background:#e3f2fd;">
        <strong>Reminder:</strong> Please ensure the <strong>30-day catchup XLS tracker</strong> shared earlier has been filled in before replying.
      </p>` : '';

  const callNote = dayMark !== 30 ? `
      <p style="color:#555;border-left:4px solid #ffa000;padding:8px 16px;background:#fffde7;">
        <strong>Note:</strong> If the call has not happened yet, please reply with a proposed date and the system will send a reminder to reschedule.
      </p>` : '';

  return sendEmail({
    to: toEmail,
    subject: `${dayMark}-Day Review — Action Required for ${name} (${employeeId})`,
    html: `
      <p>Hi,</p>
      <p>The <strong>${dayMark}-day review</strong> for <strong>${name}</strong> (ID: ${employeeId}) is due today. Please conduct the review call and reply to this email with a brief summary covering:</p>
      <ol>
        <li><strong>Performance so far</strong> — overall assessment</li>
        <li><strong>Key achievements</strong> — notable contributions or milestones</li>
        <li><strong>Areas of improvement</strong> — feedback on gaps or development needs</li>
        <li><strong>Manager feedback</strong> — reporting manager's overall view</li>
        <li><strong>Next steps</strong> — goals or action items for the next period</li>
      </ol>
      ${xlsSection}
      ${callNote}
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 18b: Admin seat allocation request — sent on DOJ to Admin/HR asking for seat confirmation
async function sendAdminSeatAllocationRequest(employee) {
  const { name, employeeId, doj } = employee;
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `Action Required — Seat Allocation Confirmation for ${name} (${employeeId})`,
    html: `
      <p>Hi Admin Team,</p>
      <p><strong>${name}</strong> (ID: ${employeeId}) is joining on <strong>${doj}</strong>. Please confirm that a workstation / seat has been allocated and is ready.</p>
      <ul>
        <li>Name: ${name}</li>
        <li>Employee ID: ${employeeId}</li>
        <li>Date of Joining: ${doj}</li>
      </ul>
      <p>Please reply to this email confirming the seat allocation so the onboarding checklist can be updated.</p>
      <p>Regards,<br/>${process.env.COMPANY_NAME} HR Automation</p>
    `,
  });
}

// Template 18: No-reply escalation — sent to HR when a stakeholder hasn't replied in 48h
async function sendNoReplyEscalation(employee, recipientType, originalRecipient) {
  const { name, employeeId } = employee;
  return sendEmail({
    to: process.env.HR_EMAIL,
    subject: `ESCALATION — No Reply from ${esc(recipientType)} for ${esc(name)} (${esc(employeeId)})`,
    html: `
      <p>Hi HR Team,</p>
      <p>This is an automated escalation notice.</p>
      <p><strong>${esc(recipientType)}</strong> (<code>${esc(originalRecipient)}</code>) has <strong>not replied</strong> to the automated onboarding request sent <strong>48 hours ago</strong> for <strong>${esc(name)}</strong> (ID: ${esc(employeeId)}).</p>
      <p>Please follow up manually with <strong>${esc(recipientType)}</strong> to ensure the required action is completed before the candidate's onboarding is impacted.</p>
      <p>Regards,<br/>${esc(process.env.COMPANY_NAME)} HR Automation</p>
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
  sendAdminSeatAllocationRequest,
  sendBGVRequest,
  sendHRInductionConfirmation,
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
