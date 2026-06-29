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

  // ── Hidden fields — pre-filled by engine when sending the form link ────────
  form.addTextItem()
    .setTitle('Employee ID')
    .setHelpText('Pre-filled by HR — do not edit')
    .setRequired(false);

  form.addTextItem()
    .setTitle('Drive Folder ID')
    .setHelpText('Pre-filled by HR — do not edit')
    .setRequired(false);

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

// ── Form submit trigger — moves uploaded files to correct Drive subfolders ──
// Set this up as an installable trigger: From form → On form submit
var FOLDER_MAP = {
  'Upload Aadhaar Card':        'Aadhaar',
  'Upload PAN Card':            'PAN',
  'Upload Address Proof':       'Aadhaar',
  'Upload Passport Size Photo': 'Passport_Photo',
  'Upload Offer Letter':        'Offer_Letter',
  'Upload 10th Marksheet':      'Marksheet_10th',
  'Upload 12th Marksheet':      'Marksheet_12th',
  'Upload Degree Certificate':  'Degree_Certificate',
  'Upload Relieving Letter':    'Relieving_Letter',
  "Upload Last Month's Payslip": 'Payslip',
};

// Root onboarding folder ID — the "Alethea Onboarding" folder in Drive
var ALETHEA_ONBOARDING_ROOT_ID = '1faqP459a9quQ3w29On8yH3Hpq95zVdZe';

function onExperiencedFormSubmit(e) {
  var responses = e.response.getItemResponses();
  var driveFolderId = '';
  var employeeId = '';
  var fileResponses = {};

  for (var i = 0; i < responses.length; i++) {
    var title = responses[i].getItem().getTitle();
    var value = responses[i].getResponse();
    if (title === 'Drive Folder ID' || title === 'Drive Folder ID( Pre-filled by HR — do not edit)') driveFolderId = value;
    else if (title === 'Employee ID' || title === 'Employee ID( Pre-filled by HR — do not edit)') employeeId = value;
    else if (FOLDER_MAP[title]) fileResponses[title] = value;
  }

  // If Drive Folder ID not pre-filled, search for the employee folder by Employee ID
  var employeeFolder = null;
  if (driveFolderId) {
    try {
      employeeFolder = DriveApp.getFolderById(driveFolderId);
    } catch (err) {
      Logger.log('⚠️ Could not open folder by ID, falling back to search: ' + err.message);
    }
  }

  if (!employeeFolder && employeeId) {
    Logger.log('🔍 Searching for employee folder by ID: ' + employeeId);
    var root = DriveApp.getFolderById(ALETHEA_ONBOARDING_ROOT_ID);
    var subfolders = root.getFolders();
    while (subfolders.hasNext()) {
      var folder = subfolders.next();
      if (folder.getName().indexOf(employeeId) !== -1) {
        employeeFolder = folder;
        Logger.log('✅ Found employee folder: ' + folder.getName());
        break;
      }
    }
  }

  if (!employeeFolder) {
    Logger.log('❌ Could not find employee folder for ID: ' + employeeId);
    return;
  }

  for (var questionTitle in fileResponses) {
    var subfolderName = FOLDER_MAP[questionTitle];
    var fileIds = fileResponses[questionTitle];
    if (!Array.isArray(fileIds)) fileIds = [fileIds];

    var subfolderIterator = employeeFolder.getFoldersByName(subfolderName);
    if (!subfolderIterator.hasNext()) {
      Logger.log('⚠️ Subfolder not found: ' + subfolderName + ' — skipping');
      continue;
    }
    var targetFolder = subfolderIterator.next();

    for (var j = 0; j < fileIds.length; j++) {
      try {
        var file = DriveApp.getFileById(fileIds[j]);
        file.moveTo(targetFolder);
        Logger.log('✅ Moved ' + file.getName() + ' → ' + subfolderName);
      } catch (err) {
        Logger.log('❌ Error moving file ' + fileIds[j] + ': ' + err.message);
      }
    }
  }

  Logger.log('✅ All files processed for employee: ' + employeeId);
}
