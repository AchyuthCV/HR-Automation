// Google Apps Script to be attached to the Recruiter Google Form
// 1. Open your Google Form
// 2. Click the 3 dots (More) -> Script editor
// 3. Paste this code
// 4. Update the WEBHOOK_URL to point to your deployed Node.js engine (or ngrok url for local testing)
// 5. Run the "setupTrigger" function manually once to authorize and attach the trigger.

const WEBHOOK_URL = 'YOUR_ENGINE_URL_HERE/employee'; // e.g., 'https://my-hr-engine.com/employee'

function setupTrigger() {
  const form = FormApp.getActiveForm();
  
  // Delete existing triggers to avoid duplicates if run multiple times
  const existingTriggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < existingTriggers.length; i++) {
    ScriptApp.deleteTrigger(existingTriggers[i]);
  }
  
  ScriptApp.newTrigger('onFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();
    
  Logger.log("Trigger setup successfully.");
}

function onFormSubmit(e) {
  try {
    const responses = e.response.getItemResponses();
    const data = {
      // Basic defaults, will be overridden by the form values
      employeeId: generateEmployeeId(), // You may want to modify how employee IDs are generated
      name: '',
      personalEmail: '',
      doj: '',
      driveFolderId: 'PENDING', // To be created by the engine or updated later
      contacts: {
        recruiterEmail: e.response.getRespondentEmail() || 'hr@yourcompany.com', 
        managerEmail: '',
        itEmail: ''
      },
      location: '',
      assetRequired: '',
      fresher: ''
    };

    // Iterate through form responses and map them
    for (let i = 0; i < responses.length; i++) {
      const itemResponse = responses[i];
      const title = itemResponse.getItem().getTitle().trim();
      const answer = itemResponse.getResponse();

      // Adjust these titles to exactly match your Google Form question titles
      if (title.includes('Employee Name')) {
        data.name = answer;
      } else if (title.includes('Personal Email')) {
        data.personalEmail = answer;
      } else if (title.includes('DOJ') || title.includes('Date of Joining')) {
        data.doj = answer;
      } else if (title.includes('Reporting Manager Email')) {
        data.contacts.managerEmail = answer;
      } else if (title.includes('IT Email')) {
        data.contacts.itEmail = answer;
      } else if (title.includes('Location')) {
        data.location = answer;
      } else if (title.includes('Asset Required')) {
        data.assetRequired = answer;
      } else if (title.includes('Fresher')) {
        data.fresher = answer;
      }
    }

    // Send payload to the HR Automation engine
    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(data),
      'muteHttpExceptions': true
    };

    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log("Webhook Response: " + response.getContentText());

  } catch (error) {
    Logger.log("Error in onFormSubmit: " + error.toString());
  }
}

// Simple helper to generate a random EMP id (e.g. EMP-A1B2C3)
// You can replace this if you have a specific ID generation strategy in your company
function generateEmployeeId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'EMP-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
