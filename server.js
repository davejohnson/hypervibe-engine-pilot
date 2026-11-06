const http = require('http');
const net = require('net');
const { Pool } = require('pg');
const version = process.env.APP_VERSION || 'v1';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }) : null;

async function database() {
  if (!pool) return { configured: false };
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS visits (id serial PRIMARY KEY, at timestamptz DEFAULT now())');
    await pool.query('CREATE TABLE IF NOT EXISTS ticks (id serial PRIMARY KEY, at timestamptz DEFAULT now())');
    const { rows } = await pool.query('SELECT (SELECT count(*) FROM visits)::int AS visits, (SELECT count(*) FROM ticks)::int AS ticks');
    return { configured: true, ok: true, ...rows[0] };
  } catch (error) {
    return { configured: true, ok: false, error: error.code || 'connection_failed' };
  }
}

// Minimal Redis client: AUTH, then the given command. Reports results only, never the URL.
function redis(command) {
  const url = process.env.REDIS_URL;
  if (!url) return Promise.resolve({ configured: false });
  const { hostname, port, password } = new URL(url);
  return new Promise((resolve) => {
    const socket = net.connect(Number(port) || 6379, hostname);
    const send = (parts) => socket.write(`*${parts.length}\r\n` + parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join(''));
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); resolve({ configured: true, ok: false, error: 'timeout' }); }, 4000);
    socket.on('connect', () => { send(['AUTH', decodeURIComponent(password)]); send(command); });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\r\n').filter(Boolean);
      if (lines.length >= 2) {
        clearTimeout(timer); socket.end();
        resolve({ configured: true, ok: lines[0] === '+OK' && !lines[1].startsWith('-'), reply: lines[1].replace(/^[:+]/, '') });
      }
    });
    socket.on('error', (error) => { clearTimeout(timer); resolve({ configured: true, ok: false, error: error.code || 'error' }); });
  });
}

async function metadataToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  return (await response.json()).access_token;
}

// Publish one message and read it back through the subscription.
async function queueRoundTrip() {
  const topic = process.env.QUEUE_TOPIC_EMAILS;
  const subscription = process.env.QUEUE_SUBSCRIPTION_EMAILS;
  if (!topic || !subscription) return { configured: false };
  const token = await metadataToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const marker = `hello-${Date.now()}`;
  const published = await fetch(`https://pubsub.googleapis.com/v1/${topic}:publish`, { method: 'POST', headers, body: JSON.stringify({ messages: [{ data: Buffer.from(marker).toString('base64') }] }) });
  if (!published.ok) return { configured: true, ok: false, error: `publish ${published.status}` };
  for (let attempt = 0; attempt < 10; attempt++) {
    const pulled = await (await fetch(`https://pubsub.googleapis.com/v1/${subscription}:pull`, { method: 'POST', headers, body: JSON.stringify({ maxMessages: 10 }) })).json();
    const messages = pulled.receivedMessages ?? [];
    if (messages.length) {
      await fetch(`https://pubsub.googleapis.com/v1/${subscription}:acknowledge`, { method: 'POST', headers, body: JSON.stringify({ ackIds: messages.map((m) => m.ackId) }) });
      const found = messages.some((m) => Buffer.from(m.message.data, 'base64').toString() === marker);
      if (found) return { configured: true, ok: true, roundTrip: true };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { configured: true, ok: false, error: 'message not received' };
}

http.createServer(async (req, res) => {
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') {
    const secret = process.env.SESSION_SECRET || '';
    const [db, cache] = await Promise.all([database(), redis(['INCR', 'health-checks'])]);
    const ok = secret.length >= 32 && (!db.configured || db.ok) && (!cache.configured || cache.ok);
    return json(ok ? 200 : 500, { ok, secretPresent: secret.length > 0, database: db, redis: cache, release: version, code: 'b6' });
  }
  if (req.url === '/visits' && pool) { await pool.query('INSERT INTO visits DEFAULT VALUES'); return json(200, await database()); }
  if (req.url === '/queue') { try { return json(200, await queueRoundTrip()); } catch (error) { return json(500, { ok: false, error: String(error.message) }); } }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Hypervibe engine pilot ${version}\n`);
}).listen(process.env.PORT || 8080);
