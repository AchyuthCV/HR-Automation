function createExperiencedPreonboardingForm() {
  const form = FormApp.create('Alethea — New Joinee Pre-Onboarding Form (Experienced)');
  form.setDescription(
    'Welcome to Alethea Communications Technologies Pvt Ltd!\n\n' +
    'Please fill this form completely before your Date of Joining. ' +
    'All documents must be uploaded as clear, legible scans or photos (PDF or JPG preferred).\n\n' +
    'If you face any issues, contact HR at hr@aletheatech.com.'
  );
  form.setConfirmationMessage(
    'Thank you for submitting your pre-onboarding details!\n\n' +
    'HR will review your documents and get in touch if anything is missing.\n\n' +
    'Welcome aboard — we look forward to having you on the team!'
  );
  form.setCollectEmail(true);

  // ── Section 1: Personal Details ───────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 1 — Personal Details');

  form.addTextItem()
    .setTitle('Full Name')
    .setHelpText('As it appears on your Aadhaar card')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Current Residential Address')
    .setHelpText('Full address including city, state and PIN code')
    .setRequired(true);

  // ── Section 2: Identity Documents ────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 2 — Identity Documents')
    .setHelpText('Upload clear scans or photos. PDF or JPG preferred.');

  form.addTextItem()
    .setTitle('Aadhaar Number')
    .setHelpText('12-digit Aadhaar number')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload Aadhaar Card')
    .setHelpText('Front and back scan in a single file. Must be clearly legible. — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle('PAN Number')
    .setHelpText('10-character PAN number e.g. ABCDE1234F')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload PAN Card')
    .setHelpText('Clear scan or photo of your PAN card (PDF or JPG). — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload Address Proof')
    .setHelpText('Any government-issued address proof — Aadhaar, Passport, Utility Bill, Rent Agreement. — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload Passport Size Photo')
    .setHelpText('Recent photo taken within the last 3 months. Plain white or light background. JPG preferred. — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload Offer Letter')
    .setHelpText('Signed copy of your Alethea offer letter (PDF). — Change this question type to File Upload')
    .setRequired(true);

  // ── Section 3: Academic Documents ────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 3 — Academic Documents')
    .setHelpText('Upload clear scans. PDF or JPG preferred.');

  form.addTextItem()
    .setTitle('Upload 10th Marksheet')
    .setHelpText('Clear scan of your 10th standard / SSLC / Matriculation marksheet (PDF or JPG). — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload 12th Marksheet')
    .setHelpText('Clear scan of your 12th standard / HSC / Diploma marksheet (PDF or JPG). — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload Degree Certificate')
    .setHelpText('Combine ALL semester marksheets (Sem 1 to Sem 8) into a SINGLE PDF in order. Include your final degree/consolidated marksheet at the end. — Change this question type to File Upload')
    .setRequired(true);

  // ── Section 4: Previous Employment Details ────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 4 — Previous Employment Details');

  form.addTextItem()
    .setTitle('Previous Company Name')
    .setHelpText('Most recent employer')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Employment Duration')
    .setHelpText('e.g. June 2022 — March 2024')
    .setRequired(true);

  form.addTextItem()
    .setTitle("Previous Manager's Email")
    .setHelpText('Email of your reporting manager at your previous company')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Upload Relieving Letter')
    .setHelpText('Relieving letter or experience letter from your most recent employer (PDF). — Change this question type to File Upload')
    .setRequired(true);

  form.addTextItem()
    .setTitle("Upload Last Month's Payslip")
    .setHelpText('Most recent payslip from your previous employer (PDF or JPG). — Change this question type to File Upload')
    .setRequired(true);

  // ── Log URLs ──────────────────────────────────────────────────────────────
  Logger.log('✅ Experienced Pre-Onboarding Form created!');
  Logger.log('🔗 Published URL: ' + form.getPublishedUrl());
  Logger.log('📋 Form ID:       ' + form.getId());
  Logger.log('→ Add Published URL to .env as PREONBOARDING_FORM_EXPERIENCED_LINK');
}
