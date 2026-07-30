// Transparent dev proxy: forwards everything (including SSE) to the live phone-companion
// server on 127.0.0.1:45678 so a preview browser can drive the real app.
const http = require('http');
const PORT = Number(process.env.PORT || 45700);
const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: 45678, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:45678' } },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (e) => { res.writeHead(502); res.end('proxy error: ' + e.message); });
  req.pipe(upstream);
});
server.listen(PORT, '127.0.0.1', () => console.log('companion proxy on http://127.0.0.1:' + PORT + ' -> 45678'));
