const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

// Scopes needed: read Drive files + send Gmail
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
];

// Build and return an authorised OAuth2 client
function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
  } else {
    throw new Error(
      'No token.json found. Run the one-time auth script first:\n  node src/auth.js'
    );
  }
  return oAuth2Client;
}

// List all files inside a Drive folder
async function listFolderFiles(auth, folderId) {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime, createdTime)',
    orderBy: 'createdTime desc',
  });
  return res.data.files || [];
}

// Create a sub-folder inside a parent Drive folder
async function createSubFolder(auth, parentFolderId, folderName) {
  const drive = google.drive({ version: 'v3', auth });
  const existing = await drive.files.list({
    q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  if (existing.data.files.length > 0) return existing.data.files[0].id;

  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });
  console.log(`[Drive] Created sub-folder "${folderName}" → ${res.data.id}`);
  return res.data.id;
}

// Move a file into a destination folder
async function moveFileTo(auth, fileId, destinationFolderId) {
  const drive = google.drive({ version: 'v3', auth });
  const file = await drive.files.get({ fileId, fields: 'parents' });
  const previousParents = file.data.parents.join(',');
  await drive.files.update({
    fileId,
    addParents: destinationFolderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });
}

// Upload / overwrite a JSON checklist file to Drive
async function uploadChecklist(auth, folderId, checklistData, filename = 'Checklist1.json') {
  const drive = google.drive({ version: 'v3', auth });
  const content = JSON.stringify(checklistData, null, 2);
  const media = { mimeType: 'application/json', body: content };

  // Check if file already exists
  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
  });

  if (existing.data.files.length > 0) {
    const fileId = existing.data.files[0].id;
    await drive.files.update({ fileId, media, fields: 'id' });
    console.log(`[Drive] Checklist updated (${fileId})`);
    return fileId;
  }

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media,
    fields: 'id',
  });
  console.log(`[Drive] Checklist created (${res.data.id})`);
  return res.data.id;
}

// Build the expected sub-folder structure inside an employee's Drive folder
async function scaffoldEmployeeFolder(auth, rootFolderId, employeeName, employeeId) {
  const folderName = `${employeeName}_${employeeId}`;
  const employeeFolderId = await createSubFolder(auth, rootFolderId, folderName);

  const subFolders = ['Documents', 'Offer_Letter', 'BGV', 'Meeting_Screenshots', 'Reports'];
  const folderMap = { root: employeeFolderId };
  for (const sf of subFolders) {
    folderMap[sf] = await createSubFolder(auth, employeeFolderId, sf);
  }
  console.log(`[Drive] Folder structure ready for ${employeeName} (${employeeId})`);
  return folderMap;
}

// ─── Drive Push Notifications ─────────────────────────────────────────────────
// Drive push channels expire after at most 1 week (604800s). We renew 1h before
// expiry. Each channel targets one folder and posts to WEBHOOK_BASE_URL/drive-push.
//
// Channel state is persisted to push-channels.json so restarts don't lose track.

const PUSH_CHANNELS_PATH = path.join(__dirname, '..', 'push-channels.json');
const PUSH_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days (Drive max is 7 days)
const RENEW_BEFORE_MS = 60 * 60 * 1000;        // renew 1 hour before expiry

function loadPushChannels() {
  if (fs.existsSync(PUSH_CHANNELS_PATH)) {
    return JSON.parse(fs.readFileSync(PUSH_CHANNELS_PATH, 'utf8'));
  }
  return {};
}

function savePushChannels(channels) {
  fs.writeFileSync(PUSH_CHANNELS_PATH, JSON.stringify(channels, null, 2));
}

// Register a Drive push channel for a folder. Returns channel metadata.
async function registerDrivePushChannel(auth, folderId, employeeId) {
  const drive = google.drive({ version: 'v3', auth });
  const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/drive-push`;
  const channelId = `hr-auto-${employeeId}-${Date.now()}`;
  const expiration = Date.now() + PUSH_TTL_MS;

  const res = await drive.files.watch({
    fileId: folderId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      expiration: String(expiration),
      token: employeeId, // echoed back in X-Goog-Channel-Token header
    },
  });

  const channel = {
    channelId,
    resourceId: res.data.resourceId,
    folderId,
    employeeId,
    expiration,
  };

  const channels = loadPushChannels();
  channels[employeeId] = channel;
  savePushChannels(channels);

  console.log(`[Drive] Push channel registered for ${employeeId} → expires ${new Date(expiration).toISOString()}`);

  // Schedule automatic renewal
  const renewIn = PUSH_TTL_MS - RENEW_BEFORE_MS;
  setTimeout(() => renewDrivePushChannel(auth, employeeId), renewIn);

  return channel;
}

// Stop an existing push channel and register a fresh one
async function renewDrivePushChannel(auth, employeeId) {
  const channels = loadPushChannels();
  const old = channels[employeeId];
  if (old) {
    try {
      const drive = google.drive({ version: 'v3', auth });
      await drive.channels.stop({ requestBody: { id: old.channelId, resourceId: old.resourceId } });
      console.log(`[Drive] Old push channel stopped for ${employeeId}`);
    } catch (err) {
      console.warn(`[Drive] Could not stop old channel for ${employeeId}:`, err.message);
    }
  }
  if (old) await registerDrivePushChannel(auth, old.folderId, employeeId);
}

// Fetch only files added/modified since `sinceMs` (used when a push notification arrives)
async function getChangedFiles(auth, folderId, sinceMs) {
  const drive = google.drive({ version: 'v3', auth });
  const sinceISO = new Date(sinceMs).toISOString();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and modifiedTime > '${sinceISO}'`,
    fields: 'files(id, name, mimeType, modifiedTime, createdTime)',
    orderBy: 'createdTime desc',
  });
  return res.data.files || [];
}

// Fallback polling — kept as a safety net when WEBHOOK_BASE_URL is not set
function watchFolderPolling(auth, folderId, onNewFile, intervalMs = 60000) {
  const seenFileIds = new Set();

  async function poll() {
    try {
      const files = await listFolderFiles(auth, folderId);
      for (const file of files) {
        if (!seenFileIds.has(file.id)) {
          seenFileIds.add(file.id);
          console.log(`[Drive] New file detected (poll): ${file.name} (${file.id})`);
          await onNewFile(file).catch(err =>
            console.error(`[Drive] Error handling file ${file.name}:`, err.message)
          );
        }
      }
    } catch (err) {
      console.error('[Drive] Poll error:', err.message);
    }
  }

  poll();
  const timer = setInterval(poll, intervalMs);
  console.log(`[Drive] Polling folder ${folderId} every ${intervalMs / 1000}s (fallback mode)`);
  return timer;
}

// Primary watch function — always polls, and also registers push channel if
// WEBHOOK_BASE_URL is a real URL (not the placeholder).
async function watchFolder(auth, folderId, employeeId, onNewFile, intervalMs = 60000) {
  const webhookUrl = process.env.WEBHOOK_BASE_URL || '';
  const isRealWebhook = webhookUrl && !webhookUrl.includes('your-ngrok-url');

  if (isRealWebhook) {
    // Register push for instant notifications AND keep polling as a safety net
    await registerDrivePushChannel(auth, folderId, employeeId);
  }

  // Always run polling regardless — catches files when push isn't set up
  return watchFolderPolling(auth, folderId, onNewFile, intervalMs);
}

module.exports = {
  getAuthClient,
  listFolderFiles,
  getChangedFiles,
  createSubFolder,
  moveFileTo,
  uploadChecklist,
  scaffoldEmployeeFolder,
  watchFolder,
  watchFolderPolling,
  registerDrivePushChannel,
  renewDrivePushChannel,
  loadPushChannels,
};
