const http = require('http');
const version = process.env.APP_VERSION || 'v1';
http.createServer((req, res) => {
  if (req.url === '/health') {
    const secret = process.env.SESSION_SECRET || '';
    res.writeHead(secret.length >= 32 ? 200 : 500, { 'Content-Type': 'application/json' });
    // Reports only that the secret arrived, never its value.
    return res.end(JSON.stringify({ ok: secret.length >= 32, secretPresent: secret.length > 0, release: version, code: 'b3' }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Hypervibe engine pilot ${version}\n`);
}).listen(process.env.PORT || 8080);
