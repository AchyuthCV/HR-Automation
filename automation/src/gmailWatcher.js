// Gmail Watch API — listens for incoming reply emails from HR / manager / IT
// and uses Claude to extract structured data from each reply.
//
// Flow:
//   1. registerGmailWatch() tells Gmail to POST to /gmail-push when inbox changes
//   2. webhookServer.js receives the push, calls processGmailPush()
//   3. processGmailPush() fetches new messages, runs them through Claude
//   4. Claude extracts reply type + data (official email ID, asset details, etc.)
//   5. index.js callback receives structured data and advances the checklist

const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GMAIL_STATE_PATH = path.join(__dirname, '..', 'gmail-state.json');

// ─── State helpers ────────────────────────────────────────────────────────────
function loadGmailState() {
  if (fs.existsSync(GMAIL_STATE_PATH)) {
    return JSON.parse(fs.readFileSync(GMAIL_STATE_PATH, 'utf8'));
  }
  return { historyId: null, watchExpiry: null };
}

function saveGmailState(state) {
  fs.writeFileSync(GMAIL_STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── Register Gmail push watch ────────────────────────────────────────────────
// Gmail watch tokens expire after 7 days — renew via renewGmailWatch().
async function registerGmailWatch(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/gmail-push`;

  // Gmail push requires a Google Cloud Pub/Sub topic — the topic must have
  // gmail-api-push@system.gserviceaccount.com as a Publisher.
  // Set GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/YOUR_TOPIC in .env
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    throw new Error('GMAIL_PUBSUB_TOPIC not set in .env — see setup guide');
  }

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      labelIds: ['INBOX'],
      topicName,
    },
  });

  const state = loadGmailState();
  state.historyId = res.data.historyId;
  state.watchExpiry = Date.now() + 6 * 24 * 60 * 60 * 1000; // renew after 6 days
  saveGmailState(state);

  console.log(`[Gmail] Watch registered — historyId: ${res.data.historyId}`);

  // Auto-renew before expiry
  setTimeout(() => renewGmailWatch(auth), 6 * 24 * 60 * 60 * 1000);
  return res.data;
}

async function renewGmailWatch(auth) {
  console.log('[Gmail] Renewing Gmail watch...');
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.stop({ userId: 'me' });
  } catch (err) {
    console.warn('[Gmail] Could not stop existing watch:', err.message);
  }
  await registerGmailWatch(auth);
}

// ─── Fetch messages added since last known historyId ─────────────────────────
async function getNewMessages(auth, newHistoryId) {
  const gmail = google.gmail({ version: 'v1', auth });
  const state = loadGmailState();
  const startHistoryId = state.historyId;

  if (!startHistoryId) {
    console.warn('[Gmail] No stored historyId — skipping history fetch');
    state.historyId = newHistoryId;
    saveGmailState(state);
    return [];
  }

  let messages = [];
  try {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    });

    const history = res.data.history || [];
    for (const entry of history) {
      for (const added of entry.messagesAdded || []) {
        messages.push(added.message);
      }
    }
  } catch (err) {
    // historyId too old — fall back to listing recent unread messages
    if (err.code === 404) {
      console.warn('[Gmail] historyId expired, fetching recent unread messages');
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread in:inbox',
        maxResults: 20,
      });
      messages = res.data.messages || [];
    } else {
      throw err;
    }
  }

  state.historyId = newHistoryId;
  saveGmailState(state);
  return messages;
}

// ─── Fetch full message content ───────────────────────────────────────────────
async function fetchMessageBody(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const msg = res.data;
  const headers = {};
  for (const h of msg.payload.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  // Extract plain text body
  let body = '';
  function extractBody(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    for (const sub of part.parts || []) extractBody(sub);
  }
  extractBody(msg.payload);

  return {
    id: messageId,
    from: headers['from'] || '',
    subject: headers['subject'] || '',
    body: body.trim(),
    threadId: msg.threadId,
  };
}

// Retry helper for Gemini quota / rate-limit errors (429 / RESOURCE_EXHAUSTED)
async function callWithRetry(fn, maxRetries = 4) {
  let delay = 10000; // start at 10s
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message && (
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('RESOURCE_EXHAUSTED')
      );
      if (is429 && attempt < maxRetries) {
        const retryMatch = err.message.match(/"retryDelay":"(\d+)s"/);
        const waitMs = retryMatch ? parseInt(retryMatch[1]) * 1000 + 2000 : delay;
        console.warn(`[Gemini] Quota hit — waiting ${Math.round(waitMs / 1000)}s before retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

// ─── Classify reply with Gemini ───────────────────────────────────────────────
// Returns { replyType, employeeId, data } or null if not an automation reply
async function classifyReply(message) {
  if (!message.body) return null;

  const prompt = `You are an HR automation assistant. Analyse this email and determine if it is a reply to an automated HR onboarding email.

FROM: ${message.from}
SUBJECT: ${message.subject}
BODY:
${message.body}

Respond ONLY with a JSON object in this exact format:
{
  "isOnboardingReply": true/false,
  "replyType": one of ["official_email_created", "manager_allocation", "it_allocation", "bgv_report", "induction_confirmed", "admin_allocation", "catchup_complete", "review_complete", "unknown"],
  "employeeId": "extracted employee ID from subject/body or null",
  "data": {
    "officialEmail": "extracted official email address or null",
    "assetType": "extracted asset type or null",
    "officeLocation": "extracted office location or null",
    "supervisorName": "extracted supervisor/buddy name or null",
    "bgvStatus": "extracted BGV status or null",
    "notes": "any other relevant details"
  },
  "confidence": "high/medium/low"
}

If this is not related to onboarding, set isOnboardingReply=false and use null for all other fields.`;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
  const response = await callWithRetry(() => model.generateContent(prompt));
  const raw = response.response.text().trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const result = JSON.parse(jsonMatch[0]);
  if (!result.isOnboardingReply) return null;

  console.log(`[Gmail] Reply classified as "${result.replyType}" for employee ${result.employeeId} (confidence: ${result.confidence})`);
  return result;
}

// Mark a message as read after processing
async function markAsRead(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}

// ─── Main entry point called by webhookServer when a Gmail push arrives ───────
// `onReplyClassified` is a callback: (classified) => void
async function processGmailPush(auth, pushData, onReplyClassified) {
  // pushData is base64-encoded JSON: { emailAddress, historyId }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(pushData.message.data, 'base64').toString());
  } catch {
    console.warn('[Gmail] Could not decode push payload');
    return;
  }

  const { historyId } = decoded;
  console.log(`[Gmail] Push received — historyId: ${historyId}`);

  const messages = await getNewMessages(auth, historyId);
  console.log(`[Gmail] ${messages.length} new message(s) to process`);

  for (const msg of messages) {
    try {
      const full = await fetchMessageBody(auth, msg.id);
      const classified = await classifyReply(full);
      if (classified && classified.confidence !== 'low') {
        await onReplyClassified(classified, full);
        await markAsRead(auth, msg.id);
      }
    } catch (err) {
      console.error(`[Gmail] Error processing message ${msg.id}:`, err.message);
    }
  }
}

module.exports = {
  registerGmailWatch,
  renewGmailWatch,
  processGmailPush,
};
