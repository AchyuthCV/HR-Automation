# Alethea HR Automation Engine

Standalone Node.js engine that automates the full employee onboarding lifecycle — from pre-joining document collection through 5-month probation verification — without any manual HR intervention.

## What it does

- Watches a Google Drive folder for new employee documents
- Verifies documents (Aadhaar, PAN, offer letter, meeting screenshots) using Gemini AI
- Sends automated emails to the employee, HR, manager, IT, and recruiter at every step
- Tracks progress in a live Google Sheet dashboard per employee
- Schedules 30/60/90-day review reminders and 5-month pre-probation alerts via cron
- Parses email replies via Gmail Watch + Pub/Sub to advance the checklist automatically
- Persists all state locally so restarts never repeat completed steps

## 8 Phases — 71 Tasks

| Phase | Description |
|-------|-------------|
| Phase 1 | Before DOJ — Recruiter checklist |
| Phase 2 | Before DOJ — Automation (docs, email creation, BGV, assets) |
| Phase 3 | Day of Joining |
| Phase 4 | 30 days after DOJ |
| Phase 5 | 60 days after DOJ |
| Phase 6 | 90 days after DOJ |
| Phase 7 | 5 months after DOJ (pre-probation) |

## Tech Stack

- **Node.js** — runtime
- **Google Drive API** — folder watching, file download, checklist upload
- **Google Sheets API** — live status dashboard per employee
- **Gmail API + Pub/Sub** — reply parsing
- **Google Calendar API** — scope reserved for calendar integration
- **Gemini AI** (`@google/generative-ai`) — document verification + reply classification
- **nodemailer** — email sending via Gmail App Password
- **node-cron** — milestone scheduling
- **Express.js** — webhook server for Drive/Gmail push notifications

## Setup

### 1. Google Cloud Console
1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable: Drive API, Gmail API, Sheets API, Calendar API
3. Create OAuth 2.0 credentials (Desktop app) → download as `credentials.json`
4. Place `credentials.json` in the `automation/` folder
5. Add your Gmail as a test user under OAuth → Audience

### 2. Install dependencies
```bash
cd automation
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Fill in all values in .env
```

### 4. One-time Google auth
```bash
node src/auth.js
# Opens browser → sign in → paste code back in terminal
# Creates token.json
```

### 5. Run
```bash
npm start
```

## Adding Employees

**Option A — Single employee via `.env`** (for testing):
Set `EMPLOYEE_*` variables in `.env`.

**Option B — Multiple employees via `employees.json`**:
```json
[
  {
    "employeeId": "EMP001",
    "name": "Full Name",
    "personalEmail": "personal@email.com",
    "officialEmail": "official@company.com",
    "doj": "2026-07-01",
    "driveFolderId": "google-drive-folder-id",
    "contacts": {
      "recruiterEmail": "recruiter@company.com",
      "managerEmail": "manager@company.com",
      "itEmail": "it@company.com"
    }
  }
]
```

**Option C — Runtime via API**:
```bash
POST http://localhost:3000/employee
Content-Type: application/json
{ "employeeId": "EMP002", "name": "...", ... }
```

## Real-time Push (optional)

For instant Drive notifications instead of 60s polling:
1. Install ngrok: `npm install -g ngrok`
2. Run: `ngrok http 3000`
3. Paste the HTTPS URL into `WEBHOOK_BASE_URL` in `.env`

For Gmail reply parsing:
1. Create a Pub/Sub topic in Google Cloud Console
2. Add `gmail-api-push@system.gserviceaccount.com` as Publisher
3. Add a Push subscription pointing to `WEBHOOK_BASE_URL/gmail-push`
4. Set `GMAIL_PUBSUB_TOPIC` in `.env`

## Files never committed

The following are in `.gitignore` and must never be committed:
- `.env` — contains API keys and passwords
- `credentials.json` — Google OAuth client secret
- `token.json` — Google OAuth access token
- `employees.json` — employee personal data
- `state.json` — checklist state with employee data
- `push-channels.json` — Drive push channel IDs
- `gmail-state.json` — Gmail history state
