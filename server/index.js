import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 5173);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Allow CORS & iframe embedding for Arena Live Preview and LAN devices
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  // Optional local BG removal chunks if installed locally
  const bgDataDir = path.join(rootDir, 'node_modules/@imgly/background-removal-data/dist');
  if (fs.existsSync(bgDataDir)) {
    app.use('/bg-data', express.static(bgDataDir, { maxAge: '7d' }));
  }

  // Serve MediaPipe Selfie Segmentation WASM/TFLite locally for instant <0.2s Passport Portrait cutouts
  const mpSelfieDir = path.join(rootDir, 'node_modules/@mediapipe/selfie_segmentation');
  app.use(
    '/mediapipe-selfie',
    express.static(mpSelfieDir, {
      maxAge: '7d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        }
      },
    })
  );

  // Health & LAN Network Info endpoint (helps generate Wi-Fi QR URLs when running on IK Computers PC)
  app.get('/api/network-info', (_req, res) => {
    const interfaces = os.networkInterfaces();
    const lanIps = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          lanIps.push({ name, address: iface.address });
        }
      }
    }
    res.json({
      shop: 'IK Computers',
      port: PORT,
      lanIps,
      timestamp: Date.now(),
    });
  });

  // WebSocket Relay for Live Mobile Urdu Keyboard -> PC Composing Studio
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map(); // roomCode -> Set<ws>

  function broadcastRoomStatus(roomCode) {
    const clients = rooms.get(roomCode);
    if (!clients) return;
    let desktopCount = 0;
    let mobileCount = 0;
    for (const client of clients) {
      if (client.readyState === 1) {
        if (client.role === 'desktop') desktopCount++;
        if (client.role === 'mobile') mobileCount++;
      }
    }
    const payload = JSON.stringify({
      type: 'room_status',
      room: roomCode,
      desktopCount,
      mobileCount,
    });
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.room = null;
    ws.role = 'unknown';

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'join' && msg.room) {
          const code = String(msg.room).trim().toUpperCase();
          if (ws.room && rooms.has(ws.room)) {
            rooms.get(ws.room).delete(ws);
          }
          ws.room = code;
          ws.role = msg.role === 'mobile' ? 'mobile' : 'desktop';
          if (!rooms.has(code)) {
            rooms.set(code, new Set());
          }
          rooms.get(code).add(ws);
          broadcastRoomStatus(code);
          return;
        }

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          return;
        }

        // Relay typing / context messages to peers in the same room
        if (ws.room && rooms.has(ws.room)) {
          const peers = rooms.get(ws.room);
          const outgoing = JSON.stringify({
            ...msg,
            senderRole: ws.role,
            ts: Date.now(),
          });
          for (const peer of peers) {
            if (peer !== ws && peer.readyState === 1) {
              peer.send(outgoing);
            }
          }
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      if (ws.room && rooms.has(ws.room)) {
        const set = rooms.get(ws.room);
        set.delete(ws);
        if (set.size === 0) {
          rooms.delete(ws.room);
        } else {
          broadcastRoomStatus(ws.room);
        }
      }
    });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: rootDir,
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: {
          server,
        },
      },
      appType: 'spa',
    });

    // Attach our /ws handler without interfering with Vite HMR upgrades
    server.on('upgrade', (req, socket, head) => {
      if (req.url && req.url.startsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    });

    app.use(vite.middlewares);
  } else {
    server.on('upgrade', (req, socket, head) => {
      if (req.url && req.url.startsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    const distDir = path.join(rootDir, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ IK Computers Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start IK Computers server:', err);
  process.exit(1);
});
