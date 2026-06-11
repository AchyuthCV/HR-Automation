// Dev helper — starts ngrok, updates WEBHOOK_BASE_URL in .env, then launches the engine.
// Usage: node src/dev.js  (or: npm run dev)
// Requires: ngrok installed globally or available via npx

const { execSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

// ─── Step 1: Check ngrok is available ─────────────────────────────────────────
try {
  execSync('npx ngrok version', { stdio: 'pipe' });
} catch (err) {
  console.error('[Dev] ngrok not found. Install it with:');
  console.error('  npm install -g ngrok');
  console.error('  npx ngrok config add-authtoken <YOUR_TOKEN>');
  process.exit(1);
}

// ─── Step 2: Spawn ngrok ───────────────────────────────────────────────────────
console.log('[Dev] Starting ngrok on port 3000...');
const ngrokProc = spawn('npx', ['ngrok', 'http', '3000'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

ngrokProc.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) console.log(`[ngrok] ${msg}`);
});

// ─── Step 3: Fetch tunnel URL from ngrok local API ────────────────────────────
function fetchNgrokUrl() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:4040/api/tunnels', (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const tunnels = data.tunnels || [];
          // Prefer the https tunnel
          const https = tunnels.find(t => t.proto === 'https');
          const tunnel = https || tunnels[0];
          if (tunnel) {
            resolve(tunnel.public_url);
          } else {
            reject(new Error('No tunnels found in ngrok API response'));
          }
        } catch (e) {
          reject(new Error('Failed to parse ngrok API response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timed out connecting to ngrok API at localhost:4040'));
    });
  });
}

// ─── Step 4: Update .env with the ngrok URL ───────────────────────────────────
function updateEnvFile(ngrokUrl) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  }

  const line = `WEBHOOK_BASE_URL=${ngrokUrl}`;
  if (/^WEBHOOK_BASE_URL=.*/m.test(content)) {
    content = content.replace(/^WEBHOOK_BASE_URL=.*/m, line);
  } else {
    content = content.trimEnd() + '\n' + line + '\n';
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// ─── Main flow ─────────────────────────────────────────────────────────────────
let engineProc = null;

async function main() {
  // Wait 2 seconds for ngrok to boot
  await new Promise(resolve => setTimeout(resolve, 2000));

  let ngrokUrl;
  try {
    ngrokUrl = await fetchNgrokUrl();
  } catch (err) {
    console.error('[Dev] Could not get ngrok URL:', err.message);
    console.error('[Dev] Make sure ngrok is running and port 4040 is accessible.');
    ngrokProc.kill();
    process.exit(1);
  }

  console.log(`[Dev] ngrok URL: ${ngrokUrl}`);
  updateEnvFile(ngrokUrl);
  console.log('[Dev] Updated WEBHOOK_BASE_URL in .env');

  // ─── Step 5: Spawn the engine ───────────────────────────────────────────────
  console.log('[Dev] Starting engine (node src/index.js)...\n');
  engineProc = spawn('node', [path.join(__dirname, 'index.js')], {
    stdio: 'inherit',
    shell: false,
  });

  engineProc.on('exit', (code) => {
    console.log(`\n[Dev] Engine exited with code ${code}`);
    ngrokProc.kill();
    process.exit(code || 0);
  });
}

// ─── Graceful shutdown on Ctrl+C ───────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[Dev] Shutting down...');
  if (engineProc) {
    engineProc.kill('SIGINT');
  }
  ngrokProc.kill();
  process.exit(0);
});

main().catch(err => {
  console.error('[Dev] Fatal error:', err.message);
  if (ngrokProc) ngrokProc.kill();
  process.exit(1);
});
