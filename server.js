const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/" || pathname === "/index.html" || pathname === "/game.js") {
    const filePath = pathname === "/" || pathname === "/index.html"
      ? path.join(__dirname, "index.html")
      : path.join(__dirname, pathname.slice(1));
    const extension = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (error, file) => {
      if (error) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Failed to load ${path.basename(filePath)}`);
        return;
      }

      res.writeHead(200, { "content-type": MIME_TYPES[extension] || "application/octet-stream" });
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
