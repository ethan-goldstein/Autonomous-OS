// Server-Sent Events hub: keeps track of connected dashboards and
// pushes live agent events (status changes, log lines, results) to all of them.
const clients = new Set();

export function addClient(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  clients.add(res);

  // Heartbeat so proxies/browsers keep the connection open.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
