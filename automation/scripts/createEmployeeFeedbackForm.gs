function createEmployeeFeedbackForm() {
  const form = FormApp.create('Employee Feedback Form — Alethea');
  form.setDescription(
    'This form is sent at the 30, 60, and 90-day marks to help HR and your reporting manager understand how you are settling in, ' +
    'identify any concerns early, and support your growth at Alethea. ' +
    'Your responses are confidential and reviewed only by HR and your reporting manager.'
  );
  form.setConfirmationMessage(
    'Thank you for submitting your feedback!\n\n' +
    'Your recruiter and reporting manager will review your responses. ' +
    'If you have raised any concerns, HR will follow up with you shortly.\n\n' +
    'We appreciate your honesty — it helps us build a better workplace.'
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

  form.addMultipleChoiceItem()
    .setTitle('Which review period is this feedback for?')
    .setChoiceValues(['30-Day Review', '60-Day Review', '90-Day Review'])
    .setRequired(true);

  // ── Section 2: Work & Role ────────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 2 — Work & Role Clarity');

  form.addScaleItem()
    .setTitle('How clear are your day-to-day responsibilities and tasks?')
    .setBounds(1, 5)
    .setLabels('Not clear at all', 'Completely clear')
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How well do you understand the goals and expectations set for you?')
    .setBounds(1, 5)
    .setLabels('Not at all', 'Very well')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Are you given enough challenging and meaningful work?')
    .setChoiceValues(['Yes, the right amount', 'Too much — feeling overwhelmed', 'Too little — not enough to do', 'Work is not relevant to my role'])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How satisfied are you with the type of work assigned to you so far?')
    .setBounds(1, 5)
    .setLabels('Very dissatisfied', 'Very satisfied')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Describe the main tasks or projects you have been working on.')
    .setRequired(false);

  // ── Section 3: Manager & Team ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 3 — Manager & Team');

  form.addScaleItem()
    .setTitle('How supported do you feel by your reporting manager?')
    .setBounds(1, 5)
    .setLabels('Not supported at all', 'Extremely supported')
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How well does your manager provide feedback and guidance?')
    .setBounds(1, 5)
    .setLabels('Never', 'Always')
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How well are you integrating with your team?')
    .setBounds(1, 5)
    .setLabels('Not at all', 'Very well')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Do you feel comfortable raising concerns or questions with your manager?')
    .setChoiceValues(['Yes, always', 'Most of the time', 'Sometimes', 'No, not comfortable'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Any specific feedback about your team or manager you\'d like to share?')
    .setHelpText('This is optional and confidential.')
    .setRequired(false);

  // ── Section 4: Work Environment ───────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 4 — Work Environment & Tools');

  form.addScaleItem()
    .setTitle('How comfortable is your physical work environment (office / remote setup)?')
    .setBounds(1, 5)
    .setLabels('Very uncomfortable', 'Very comfortable')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Do you have all the tools and system access you need to do your job?')
    .setChoiceValues(['Yes, everything I need', 'Most things — a few gaps', 'No — missing several things'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('What tools or access are you still missing?')
    .setHelpText('Leave blank if everything is in order.')
    .setRequired(false);

  // ── Section 5: Learning & Growth ─────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 5 — Learning & Growth');

  form.addScaleItem()
    .setTitle('How much have you learned and grown professionally in this period?')
    .setBounds(1, 5)
    .setLabels('Nothing new', 'A great deal')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Are you receiving enough guidance and mentorship to grow in your role?')
    .setChoiceValues(['Yes, plenty', 'Some, but could be more', 'Very little', 'None at all'])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('What kind of support would help you perform better? (select all that apply)')
    .setChoiceValues([
      'More regular 1:1s with my manager',
      'Clearer goals and KPIs',
      'Technical training or upskilling',
      'Better documentation / knowledge base',
      'A buddy or mentor',
      'More team collaboration',
      'Improved tools or processes',
    ])
    .setRequired(false);

  // ── Section 6: Well-being & Concerns ─────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 6 — Well-being & Concerns');

  form.addScaleItem()
    .setTitle('How would you rate your overall well-being and work-life balance currently?')
    .setBounds(1, 5)
    .setLabels('Very poor', 'Excellent')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Are you experiencing any stress or concerns that are affecting your work?')
    .setChoiceValues(['No, all good', 'Minor stress — managing fine', 'Yes — some concerns I\'d like to discuss', 'Yes — significant concerns'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Please describe any concerns you would like HR to be aware of.')
    .setHelpText('This is confidential. HR will follow up with you privately.')
    .setRequired(false);

  // ── Section 7: Overall Rating ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Section 7 — Overall');

  form.addScaleItem()
    .setTitle('Overall, how satisfied are you with your experience at Alethea so far?')
    .setBounds(1, 10)
    .setLabels('Very dissatisfied', 'Extremely satisfied')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Would you recommend Alethea as a great place to work to someone you know?')
    .setChoiceValues(['Definitely yes', 'Probably yes', 'Not sure', 'Probably not', 'Definitely not'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Any other comments, suggestions, or feedback for HR or management?')
    .setRequired(false);

  // ── Log URLs ──────────────────────────────────────────────────────────────
  Logger.log('✅ Employee Feedback Form created successfully!');
  Logger.log('🔗 Published URL: ' + form.getPublishedUrl());
  Logger.log('📝 Edit URL:      ' + form.getEditUrl());
  Logger.log('📋 Form ID:       ' + form.getId());
  Logger.log('');
  Logger.log('→ Copy the Published URL into your .env as EMPLOYEE_FEEDBACK_FORM_LINK');
}
