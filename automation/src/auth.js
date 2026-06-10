// Run this ONCE to authorise the app with your Google account.
// It opens a browser URL — paste the code back into the terminal.
// Creates token.json which is then used automatically by driveWatcher.js.
//
// Usage:  node src/auth.js

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
];

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`\nERROR: credentials.json not found at ${CREDENTIALS_PATH}`);
    console.error('Download it from: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON\n');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\n1. Open this URL in your browser:\n');
  console.log('  ', authUrl);
  console.log('\n2. Authorise the app, then paste the code below:\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the authorisation code: ', async (code) => {
    rl.close();
    const { tokens } = await oAuth2Client.getToken(code.trim());
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`\n✓ token.json saved to ${TOKEN_PATH}`);
    console.log('  You can now run:  node src/index.js\n');
  });
}

main().catch(err => { console.error(err.message); process.exit(1); });
