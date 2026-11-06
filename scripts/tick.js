// Scheduled job: records one row per run so the app can prove the schedule fires.
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS ticks (id serial PRIMARY KEY, at timestamptz DEFAULT now())');
  await client.query('INSERT INTO ticks DEFAULT VALUES');
  const { rows } = await client.query('SELECT count(*)::int AS n FROM ticks');
  console.log(`tick recorded; total ${rows[0].n}`);
  await client.end();
})().catch((error) => { console.error('tick failed:', error.code || error.message); process.exit(1); });
