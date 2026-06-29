// Run this function to get the entry IDs for pre-filling the form URL.
// Paste the form ID from the form URL (the long ID between /d/ and /edit or /viewform)
// Run once for each form and note down the entry IDs.

function getFormEntryIds() {
  var FRESHER_FORM_ID = '1eRw80xX0K2dS3m3EpTLtismW3FDlHIC2JHfAihO729k';
  var EXPERIENCED_FORM_ID = '1QbzWf5lwUUORct8mfAyaGez9lCPtF0y_HUdirz7mu3A';

  Logger.log('=== FRESHER FORM ===');
  getEntryIds(FRESHER_FORM_ID);

  Logger.log('=== EXPERIENCED FORM ===');
  getEntryIds(EXPERIENCED_FORM_ID);
}

function getEntryIds(formId) {
  // Form ID needs to be the actual Google Form ID, not the published URL ID
  // Go to your form editor URL: docs.google.com/forms/d/FORM_ID/edit
  // Copy the FORM_ID part from there
  try {
    var form = FormApp.openById(formId);
    var items = form.getItems();
    for (var i = 0; i < items.length; i++) {
      Logger.log('Title: "' + items[i].getTitle() + '" | Entry ID: entry.' + items[i].getId());
    }
  } catch (err) {
    Logger.log('Error: ' + err.message + ' — Make sure you use the EDIT form ID not the published URL ID');
    Logger.log('Go to the form editor and copy the ID from: docs.google.com/forms/d/ACTUAL_ID/edit');
  }
}
