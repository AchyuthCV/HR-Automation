# Alethea HR Automation Engine

Standalone Node.js engine that automates the full employee onboarding lifecycle — from pre-joining document collection through 5-month probation verification — without any manual HR intervention.

## What it does

- Watches a Google Drive folder for new employee documents
- Verifies documents (Aadhaar, PAN, offer letter, meeting screenshots) using Gemini AI
- Sends automated emails to the employee, HR, manager, IT, and recruiter at every step
- 3-strike reminder chain (24h / 48h / 72h) to employee for missing or rejected docs; recruiter escalated after 3rd reminder
- Tracks progress in a live Google Sheet dashboard per employee
- Schedules 30/60/90-day review reminders and 5-month pre-probation alerts via cron
- Sends onboarding survey + employee feedback form at day 25
- Shares project intro catchup sheet with new joiner
- Creates calendar invites for HR induction, project intro, 30/60/90-day catchup calls
- Parses email replies via Gmail Watch + Pub/Sub to advance the checklist automatically
- Persists all state locally so restarts never repeat completed steps

## 7 Phases — 71 Tasks

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
- **Google Calendar API** — induction, project intro, 30/60/90-day review events
- **Gemini AI** (`@google/generative-ai`) — document verification + reply classification
- **nodemailer** — email templates via Gmail App Password, 3-retry backoff
- **node-cron** — milestone scheduling (survey, 30/60/90-day, 5-month)
- **Express.js** — webhook server, status dashboard, JSON debug endpoints

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
npm run auth
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

**Option B — Interactive CLI**:
```bash
npm run add-employee
# Prompts for all fields with validation
```

**Option C — Multiple employees via `employees.json`**:
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

**Option D — Runtime via API**:
```bash
POST http://localhost:3000/employee
Content-Type: application/json
{ "employeeId": "EMP002", "name": "...", ... }
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run add-employee` | Interactive wizard to register a new employee |
| `npm run list-employees` | Table of all employees with DOJ and progress % |
| `npm run remove-employee` | Remove an employee from employees.json and clean up their files |
| `npm run reset-employee` | Wipe one employee's state so they re-onboard from scratch |
| `npm run view-state -- EMP001` | Pretty-print an employee's persisted state file |
| `npm run mark-task -- EMP001 t15` | Manually mark a checklist task done (bypasses automation) |

## Web Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | JSON health check — uptime, employee list, task counts |
| `GET /employees` | Full employee list with checklists |
| `GET /status` | HTML dashboard — all employees, progress bars |
| `GET /status/:employeeId` | HTML per-employee status page — checklist, verification results, activity log, stuck-task badges |
| `GET /state/:employeeId` | Raw JSON checklist state (for debugging) |
| `POST /employee` | Register a new employee and start onboarding |
| `POST /drive-push` | Google Drive push notification receiver |
| `POST /gmail-push` | Gmail Pub/Sub push notification receiver |

## Real-time Push (optional)

For instant Drive notifications instead of polling:
1. Install ngrok: `npm install -g ngrok`
2. Run: `ngrok http 3000`
3. Paste the HTTPS URL into `WEBHOOK_BASE_URL` in `.env`

For Gmail reply parsing:
1. Create a Pub/Sub topic in Google Cloud Console
2. Add `gmail-api-push@system.gserviceaccount.com` as Publisher
3. Add a Push subscription pointing to `WEBHOOK_BASE_URL/gmail-push`
4. Set `GMAIL_PUBSUB_TOPIC` in `.env`

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main orchestrator — boots engine, loads employees, wires everything together |
| `src/config.js` | Single source of truth for all hardcoded values (timezone, milestone days, calendar times) |
| `src/emailSender.js` | 19 email templates, 3-retry backoff |
| `src/cronJobs.js` | Milestone scheduling (survey, 30/60/90-day, 5-month) |
| `src/driveWatcher.js` | Drive folder polling and push-channel management |
| `src/gmailWatcher.js` | Gmail Watch subscription and reply parsing |
| `src/calendarService.js` | Creates Google Calendar events for induction, reviews |
| `src/statusTracker.js` | Writes/updates per-employee Google Sheet dashboard |
| `src/webhookServer.js` | Express server — push handlers, status pages, debug endpoints |
| `src/activityLog.js` | Append-only per-employee event log in `logs/<employeeId>.log` |
| `src/addEmployee.js` | Interactive CLI to register new employees |
| `src/listEmployees.js` | CLI employee list with progress |
| `src/removeEmployee.js` | CLI to remove an employee and clean up files |
| `src/resetEmployee.js` | CLI to wipe an employee's state for re-onboarding |
| `src/markTask.js` | CLI to manually mark a task done |
| `src/viewState.js` | CLI to pretty-print a state file |

## Drive Folder Structure (per employee)

Each new employee gets a folder `Name_EMPID` created automatically inside the Alethea Onboarding root with these subfolders:

```
Aadhaar / PAN / Offer_Letter / Passport_Photo / Passport / UAN /
Payslip / Relieving_Letter / Marksheet_10th / Marksheet_12th /
Degree_Certificate / Postgrad_Certificate / BGV /
Meeting_Screenshots / Reports
```

An `UPLOAD_INSTRUCTIONS.txt` file is placed in the employee's folder explaining exactly what to upload and where.

## Required Documents

**Mandatory (all employees):**
- Aadhaar Card
- PAN Card
- Signed Offer Letter
- Passport Size Photo
- 10th Marksheet
- 12th Marksheet / Diploma
- Graduation Degree Certificate
- Relieving Letter *(experienced candidates — mandatory for BGV)*

**Previous Employment (conditional — upload into `Relieving_Letter` or `Payslip` folder):**
- Employer 1 (most recent) — mandatory if previously employed, submit within 30–60 days
- Employer 2 — required if worked with 2 or more employers
- Employer 3 — required if worked with 3 or more employers
- For each employer: Relieving-cum-Experience Letter OR Full & Final Settlement Letter OR Last Month's Payslip
- Freshers skip this section entirely

**Optional:**
- Post Graduation Certificate
- Passport *(upload only if available)*
- UAN *(via UMANG app — experienced candidates, case by case)*

## Document Reminder Logic

When a document fails verification or is not uploaded:

1. Immediate rejection email sent to employee with the reason
2. **24h** — Reminder 1 sent to employee
3. **48h** — Reminder 2 sent to employee
4. **72h** — Final Reminder sent to employee + recruiter escalation alert

Successful re-upload at any point cancels all pending reminders automatically.

## Giving Someone Access

**View only (no engine setup needed):**
1. Share the Alethea Onboarding Google Drive folder with their Gmail
2. Share the Status Google Sheet with their Gmail
3. Add them as collaborator on this GitHub repo (Read access)

**Run the engine:**
1. All of the above
2. Share `credentials.json`, `token.json`, and `.env` securely (not via email or GitHub)
3. Add their Google account to the Google Cloud project (IAM → Editor)
4. They run `node src/auth.js` once to generate their own `token.json`

> Share sensitive files only via secure channels — encrypted messaging or a password manager. Never commit them to Git.

## Runtime Files (not committed)

| File | Description |
|------|-------------|
| `state-<ID>.json` | Per-employee checklist state — one file per employee |
| `seen-files.json` | Drive file IDs already processed — prevents re-processing on restart |
| `seen-files-meta.json` | Timestamps for `seen-files.json` entries — used to prune IDs older than 30 days |
| `logs/<ID>.log` | Append-only activity log per employee (JSON lines) |
| `employees.json` | Registered employees (contains personal data — never commit) |
| `.env` | API keys, passwords, URLs |
| `credentials.json` | Google OAuth client secret |
| `token.json` | Google OAuth access token |
| `push-channels.json` | Drive push channel IDs |
| `gmail-state.json` | Gmail history state |
