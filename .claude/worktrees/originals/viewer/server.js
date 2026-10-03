import { createServer } from 'http';
import { readFileSync, existsSync, watch, open, read, statSync, writeFileSync, createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3333;
const LOG_FILE = join(__dirname, '..', '.logs', 'agent.log');

// Track connected SSE clients
const clients = new Set();

// File position tracker for tailing
let filePosition = 0;
let fileWatcher = null;
let readPending = false;

// Read new content from log file and broadcast to clients
function broadcastNewContent() {
  if (readPending || !existsSync(LOG_FILE)) return;
  
  try {
    const stats = statSync(LOG_FILE);
    
    // File was truncated (new run)
    if (stats.size < filePosition) {
      filePosition = 0;
    }
    
    // No new content
    if (stats.size <= filePosition) return;
    
    readPending = true;
    
    // Read only the new bytes
    const newSize = stats.size - filePosition;
    const buffer = Buffer.alloc(newSize);
    
    open(LOG_FILE, 'r', (err, fd) => {
      if (err) {
        readPending = false;
        return;
      }
      
      read(fd, buffer, 0, newSize, filePosition, (readErr, bytesRead, buf) => {
        readPending = false;
        
        if (!readErr && bytesRead > 0) {
          const newContent = buf.toString('utf8', 0, bytesRead);
          filePosition += bytesRead;
          
          // Broadcast to all connected clients
          const message = `data: ${JSON.stringify({ content: newContent })}\n\n`;
          for (const client of clients) {
            try {
              client.write(message);
            } catch {
              clients.delete(client);
            }
          }
        }
        
        // Close file descriptor
        import('fs').then(fs => fs.close(fd, () => {}));
      });
    });
  } catch {
    readPending = false;
  }
}

// Set up file watcher
function setupWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
  }
  
  if (existsSync(LOG_FILE)) {
    filePosition = statSync(LOG_FILE).size;
    
    // Use fs.watch for event-based (not polling) file watching
    fileWatcher = watch(LOG_FILE, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        // Small debounce to batch rapid writes
        setImmediate(broadcastNewContent);
      }
    });
    
    fileWatcher.on('error', () => {
      // File might have been deleted, try to re-watch
      setTimeout(setupWatcher, 1000);
    });
  } else {
    // Log file doesn't exist yet, poll for its creation
    setTimeout(setupWatcher, 1000);
  }
}

// Also poll at a slower rate as backup (fs.watch can miss events)
setInterval(broadcastNewContent, 500);

// Initial setup
setupWatcher();

// Keep-alive ping every 15 seconds to prevent connection timeout
setInterval(() => {
  for (const client of clients) {
    try {
      client.write(': keepalive\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, 15000);

const server = createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.url === '/') {
    // Serve HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dirname, 'index.html'), 'utf8'));
  } else if (req.url === '/stream') {
    // SSE endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });
    
    // Disable Nagle's algorithm for faster streaming
    res.socket?.setNoDelay?.(true);
    
    // Send existing log content
    if (existsSync(LOG_FILE)) {
      const existing = readFileSync(LOG_FILE, 'utf8');
      filePosition = Buffer.byteLength(existing, 'utf8');
      res.write(`data: ${JSON.stringify({ content: existing, initial: true })}\n\n`);
    }
    
    clients.add(res);
    
    req.on('close', () => {
      clients.delete(res);
    });
  } else if (req.url === '/clear') {
    // Clear the log
    writeFileSync(LOG_FILE, '');
    filePosition = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🎬 Agent Viewer running at http://localhost:${PORT}\n`);
  console.log(`Watching: ${LOG_FILE}`);
  console.log(`\nMake sure to run ./loop.sh to see output.\n`);
});
