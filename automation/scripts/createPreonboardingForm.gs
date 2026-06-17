function createPreOnboardingForm() {
  const form = FormApp.create('Pre-Onboarding Form — Alethea');
  form.setDescription('Please complete this form before your Date of Joining. This helps us set up your accounts, workspace, and documents in advance.');
  form.setConfirmationMessage(
    'Thank you! Your pre-onboarding form has been submitted successfully.\n\n' +
    'Next step — please upload your documents to your personal onboarding folder using the link shared by your recruiter.\n\n' +
    'Documents to upload (name your files with the keyword shown):\n' +
    '• Aadhaar card → include "aadhaar" in filename\n' +
    '• PAN card → include "pan" in filename\n' +
    '• Signed offer letter → include "offer" in filename\n' +
    '• Passport size photo → include "photo" in filename\n' +
    '• 10th marksheet → include "10th" in filename\n' +
    '• 12th / Diploma marksheet → include "12th" or "diploma" in filename\n' +
    '• Graduation degree certificate → include "degree" or "graduation" in filename\n' +
    '• Post graduation certificate (if applicable) → include "postgrad" or "masters" in filename\n' +
    '• Last payslip (if applicable) → include "payslip" in filename\n' +
    '• Relieving letter (if applicable) → include "relieving" in filename\n\n' +
    'Please upload within 24 hours. Contact HR if you need help.\n\nWelcome to Alethea!'
  );
  form.setCollectEmail(true);

  // ── Section 1: Personal Details ──────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 1 — Personal Details');

  form.addTextItem().setTitle('Full Name (as per Aadhaar)').setRequired(true);
  form.addTextItem().setTitle('Name as per PAN Card').setRequired(true);
  form.addTextItem().setTitle('Name as per Bank Records').setRequired(true);
  form.addTextItem().setTitle('Personal Email Address').setRequired(true);
  form.addTextItem().setTitle('Personal Mobile Number').setRequired(true);
  form.addDateItem().setTitle('Date of Birth').setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Gender')
    .setChoiceValues(['Male', 'Female', 'Prefer not to say'])
    .setRequired(true);
  form.addTextItem().setTitle('Blood Group').setRequired(true);
  form.addTextItem().setTitle('Father\'s Name').setRequired(true);
  form.addTextItem().setTitle('Mother\'s Name').setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Marital Status')
    .setChoiceValues(['Single', 'Married', 'Divorced', 'Widowed'])
    .setRequired(true);
  form.addTextItem().setTitle('Name of Spouse (if married)').setRequired(false);
  form.addDateItem().setTitle('Date of Birth of Spouse (if married)').setRequired(false);
  form.addTextItem().setTitle('Profession of Spouse (if married)').setRequired(false);
  form.addTextItem().setTitle('Number of Children').setRequired(false);
  form.addTextItem().setTitle('Name(s) of Child / Children').setRequired(false);
  form.addTextItem().setTitle('Knowledge of Foreign Languages (if any)')
    .setHelpText('e.g. French — Conversational, German — Basic. Leave blank if not applicable.')
    .setRequired(false);

  // ── Section 2: Address ────────────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 2 — Address Details');

  form.addParagraphTextItem()
    .setTitle('Current Address')
    .setHelpText('House/Flat No, Street, Area, City, State, PIN Code')
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('Permanent Address')
    .setHelpText('Leave blank if same as current address')
    .setRequired(false);

  // ── Section 3: Emergency Contact ─────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 3 — Emergency Contact');

  form.addTextItem().setTitle('Emergency Contact Name').setRequired(true);
  form.addTextItem().setTitle('Relationship to You').setRequired(true);
  form.addTextItem().setTitle('Emergency Contact Mobile Number').setRequired(true);

  // ── Section 4: Nominee Details ────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 4 — Nominee Details for Group Insurance');

  form.addParagraphTextItem()
    .setTitle('Nominee Details')
    .setHelpText('Provide name, relationship, date of birth, and percentage share for each nominee.\ne.g. Ravi Kumar — Father — 01/01/1965 — 100%')
    .setRequired(true);

  // ── Section 5: Bank Details ───────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 5 — Bank Details (for payroll setup)');

  form.addTextItem().setTitle('Account Holder Name (as per bank records)').setRequired(true);
  form.addTextItem().setTitle('Bank Name').setRequired(true);
  form.addTextItem().setTitle('Branch Name').setRequired(true);
  form.addTextItem().setTitle('IFSC Code').setRequired(true);
  form.addTextItem().setTitle('Account Number').setRequired(true);
  form.addTextItem().setTitle('Confirm Account Number')
    .setHelpText('Re-enter your account number to confirm')
    .setRequired(true);

  // ── Section 6: Government IDs ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 6 — Government IDs');

  form.addTextItem().setTitle('Aadhaar Number').setRequired(true);
  form.addTextItem().setTitle('PAN Number').setRequired(true);
  form.addTextItem().setTitle('Passport Number (if available)')
    .setHelpText('Not Mandatory — leave blank if not applicable')
    .setRequired(false);
  form.addTextItem().setTitle('UAN Number (if available)')
    .setHelpText('Not Mandatory — Universal Account Number for PF. You can set it up after joining.')
    .setRequired(false);

  // ── Section 7: Previous Employment ───────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 7 — Previous Employment (if applicable)');

  form.addTextItem().setTitle('Previous Company Name').setRequired(false);
  form.addTextItem().setTitle('Last Designation').setRequired(false);
  form.addDateItem().setTitle('Last Working Day').setRequired(false);
  form.addParagraphTextItem().setTitle('Reason for Leaving').setRequired(false);

  // ── Section 8: Document Upload Confirmation ───────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 8 — Document Checklist');

  form.addCheckboxItem()
    .setTitle('Which documents do you have ready to upload? (select all that apply)')
    .setHelpText('You will upload these to your personal Drive folder shared by your recruiter.')
    .setChoiceValues([
      'Aadhaar card (front and back)',
      'PAN card',
      'Signed offer letter',
      'Passport size photo',
      '10th standard marksheet',
      '12th standard / Diploma marksheet',
      'Graduation consolidated marksheet and degree certificate',
      'Post graduation degree certificate (Masters / MBA / MTech / PhD)',
      'Last payslip (only if previously employed)',
      'Relieving letter (only if previously employed)',
      'Passport copy (not mandatory)',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Have you created your UAN via the UMANG app?')
    .setHelpText('Not Mandatory — you can set this up after joining.')
    .setChoiceValues(['Yes', 'No — Will do after joining', 'Not sure what this is'])
    .setRequired(false);

  // ── Section 9: Declaration ────────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 9 — Declaration');

  form.addMultipleChoiceItem()
    .setTitle('I confirm that all the information provided above is true and accurate to the best of my knowledge.')
    .setChoiceValues(['Yes, I confirm'])
    .setRequired(true);

  // ── Log URLs ──────────────────────────────────────────────────────────────
  Logger.log('✅ Form created successfully!');
  Logger.log('🔗 Published URL: ' + form.getPublishedUrl());
  Logger.log('📝 Edit URL:      ' + form.getEditUrl());
  Logger.log('📋 Form ID:       ' + form.getId());
  Logger.log('');
  Logger.log('→ Copy the Published URL into your .env as PREONBOARDING_FORM_LINK');
}
