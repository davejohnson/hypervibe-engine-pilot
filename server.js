const http = require('http');
const { Pool } = require('pg');
const version = process.env.APP_VERSION || 'v1';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }) : null;

async function database() {
  if (!pool) return { configured: false };
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS visits (id serial PRIMARY KEY, at timestamptz DEFAULT now())');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM visits');
    return { configured: true, ok: true, visits: rows[0].n };
  } catch (error) {
    // Report the failure class only; never connection details.
    return { configured: true, ok: false, error: error.code || 'connection_failed' };
  }
}

http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const secret = process.env.SESSION_SECRET || '';
    const db = await database();
    const ok = secret.length >= 32 && (!db.configured || db.ok);
    res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok, secretPresent: secret.length > 0, database: db, release: version, code: 'b5-local' }));
  }
  if (req.url === '/visits' && pool) {
    await pool.query('INSERT INTO visits DEFAULT VALUES');
    return res.end(JSON.stringify(await database()));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Hypervibe engine pilot ${version}\n`);
}).listen(process.env.PORT || 8080);
