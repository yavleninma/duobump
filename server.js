const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const INDEX_PATH = path.join(__dirname, "index.html");

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    fs.readFile(INDEX_PATH, (error, file) => {
      if (error) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Failed to load index.html");
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(file);
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`DuoBump static server running on http://localhost:${PORT}`);
});
