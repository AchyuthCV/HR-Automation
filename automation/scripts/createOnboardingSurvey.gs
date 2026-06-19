function createOnboardingSurvey() {
  const form = FormApp.create('Onboarding Survey — Alethea');
  form.setDescription(
    'Hi! You have completed your first 25 days at Alethea. We would love to hear about your onboarding experience. ' +
    'This survey is confidential and takes less than 5 minutes to complete. Your feedback helps us improve the experience for future joiners.'
  );
  form.setConfirmationMessage(
    'Thank you for completing the Onboarding Survey!\n\n' +
    'Your feedback is valuable and will be reviewed by HR. ' +
    'If you have any urgent concerns, please reach out directly to your recruiter or HR.\n\n' +
    'Welcome to the Alethea family!'
  );
  form.setCollectEmail(true);

  // ── Section 1: Basic Info ─────────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 1 — Basic Information');

  form.addTextItem()
    .setTitle('Your Full Name')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Employee ID')
    .setHelpText('e.g. EMP001')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Department / Team')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Reporting Manager\'s Name')
    .setRequired(true);

  form.addDateItem()
    .setTitle('Date of Joining')
    .setRequired(true);

  // ── Section 2: Pre-Joining Experience ────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 2 — Pre-Joining Experience');

  form.addScaleItem()
    .setTitle('How smooth was the pre-onboarding process (document submission, communication from HR)?')
    .setBounds(1, 5)
    .setLabels('Very Difficult', 'Very Smooth')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Did you receive clear instructions on what documents to upload and where?')
    .setChoiceValues(['Yes, very clear', 'Somewhat clear', 'No, it was confusing'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Was your official email and Greythr login ready on your first day?')
    .setChoiceValues(['Yes', 'No — it took a day or two', 'No — it took longer than expected'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Were your assets (laptop, access card, workstation) ready on your first day?')
    .setChoiceValues(['Yes, everything was ready', 'Some things were ready', 'Nothing was ready'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Any issues or delays you faced before or on your first day?')
    .setHelpText('Leave blank if everything went smoothly.')
    .setRequired(false);

  // ── Section 3: HR Induction ───────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 3 — HR Induction');

  form.addMultipleChoiceItem()
    .setTitle('Did you have an HR induction session?')
    .setChoiceValues(['Yes', 'No'])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How helpful was the HR induction session?')
    .setBounds(1, 5)
    .setLabels('Not helpful at all', 'Extremely helpful')
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('Which topics were covered in your induction? (select all that apply)')
    .setChoiceValues([
      'Company overview and culture',
      'Policies and code of conduct',
      'Leave and attendance',
      'Payroll and benefits',
      'Tools and systems used',
      'Team introductions',
      'Project overview',
    ])
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('What topics do you wish were covered but were not?')
    .setRequired(false);

  // ── Section 4: Project Introduction ──────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 4 — Project & Team Introduction');

  form.addScaleItem()
    .setTitle('How well were you introduced to your team and project?')
    .setBounds(1, 5)
    .setLabels('Not at all', 'Extremely well')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Do you have a clear understanding of your role and responsibilities?')
    .setChoiceValues(['Yes, very clear', 'Somewhat clear', 'Not clear at all'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Were your initial tasks and goals explained to you?')
    .setChoiceValues(['Yes', 'Partially', 'No'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Do you have a buddy / mentor assigned to help you settle in?')
    .setChoiceValues(['Yes', 'No', 'Not sure'])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How supported do you feel by your reporting manager?')
    .setBounds(1, 5)
    .setLabels('Not supported', 'Very well supported')
    .setRequired(true);

  // ── Section 5: Tools & Access ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 5 — Tools & System Access');

  form.addCheckboxItem()
    .setTitle('Which tools / systems do you have access to? (select all that apply)')
    .setChoiceValues([
      'Official email',
      'Greythr (HRMS)',
      'Project management tool (Jira / Trello / Asana)',
      'Communication tool (Slack / Teams)',
      'Code repository (GitHub / GitLab / Bitbucket)',
      'Internal wiki / documentation',
      'VPN / remote access',
    ])
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('Are there any tools or accesses you still don\'t have that you need?')
    .setRequired(false);

  // ── Section 6: Overall Experience ────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 6 — Overall Onboarding Experience');

  form.addScaleItem()
    .setTitle('Overall, how would you rate your onboarding experience at Alethea?')
    .setBounds(1, 10)
    .setLabels('Very Poor', 'Excellent')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Would you say you feel comfortable and settled in your role so far?')
    .setChoiceValues(['Yes, completely', 'Mostly yes', 'Still getting there', 'Not yet'])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('What did we do well during your onboarding? (select all that apply)')
    .setChoiceValues([
      'Clear communication before joining',
      'Timely document processing',
      'Asset and workspace readiness',
      'Helpful induction session',
      'Good team introduction',
      'Clear role and goal setting',
      'Responsive HR team',
    ])
    .setRequired(false);

  form.addCheckboxItem()
    .setTitle('What could we have done better? (select all that apply)')
    .setChoiceValues([
      'Faster document processing',
      'Better communication before joining',
      'Asset readiness on day 1',
      'More detailed induction',
      'Clearer role expectations',
      'More structured first week plan',
      'Assigning a buddy earlier',
    ])
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('Any other feedback or suggestions to improve the onboarding experience?')
    .setRequired(false);

  // ── Log URLs ──────────────────────────────────────────────────────────────
  Logger.log('✅ Onboarding Survey created successfully!');
  Logger.log('🔗 Published URL: ' + form.getPublishedUrl());
  Logger.log('📝 Edit URL:      ' + form.getEditUrl());
  Logger.log('📋 Form ID:       ' + form.getId());
  Logger.log('');
  Logger.log('→ Copy the Published URL into your .env as ONBOARDING_SURVEY_LINK');
}
