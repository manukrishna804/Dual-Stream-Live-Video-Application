const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Active connections storage
const clients = new Map(); // clientId -> { ws, metadata }
const hosts = new Map();   // hostId -> ws

// Utility to broadcast to all hosts
function broadcastToHosts(message) {
  const payload = JSON.stringify(message);
  for (const [hostId, hostWs] of hosts.entries()) {
    if (hostWs.readyState === WebSocket.OPEN) {
      hostWs.send(payload);
    }
  }
}

// WebSocket communication routing
wss.on('connection', (ws) => {
  let sessionRole = null;
  let sessionId = null;

  ws.on('message', (messageBuffer) => {
    try {
      const messageText = messageBuffer.toString('utf8');
      const data = JSON.parse(messageText);
      const { type, role, senderId, targetId } = data;

      switch (type) {
        case 'register':
          sessionRole = role;
          sessionId = senderId;

          if (role === 'host') {
            hosts.set(sessionId, ws);
            console.log(`Host registered: ${sessionId}`);
            
            // Notify all active clients that a host has joined
            const clientList = Array.from(clients.keys());
            ws.send(JSON.stringify({ type: 'welcome-host', clients: clientList }));
            
            // Alert all existing clients to start signaling with this host
            for (const [clientId, clientInfo] of clients.entries()) {
              if (clientInfo.ws.readyState === WebSocket.OPEN) {
                clientInfo.ws.send(JSON.stringify({ type: 'host-joined', hostId: sessionId }));
              }
            }
          } else if (role === 'client') {
            clients.set(sessionId, { ws, name: data.name || 'Anonymous User' });
            console.log(`Client registered: ${sessionId}`);

            // Notify all hosts about the new client
            broadcastToHosts({ 
              type: 'client-joined', 
              clientId: sessionId, 
              name: data.name || 'Anonymous User' 
            });

            // If a host is already online, let this new client know so they can initiate
            if (hosts.size > 0) {
              const activeHostIds = Array.from(hosts.keys());
              ws.send(JSON.stringify({ type: 'hosts-available', hosts: activeHostIds }));
            }
          }
          break;

        case 'offer':
        case 'answer':
        case 'candidate':
          // Relay signaling traffic to the specific target peer
          if (targetId) {
            let targetWs = null;
            if (hosts.has(targetId)) {
              targetWs = hosts.get(targetId);
            } else if (clients.has(targetId)) {
              targetWs = clients.get(targetId).ws;
            }

            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(messageText);
            } else {
              console.warn(`Routing failed: Target ${targetId} for message type '${type}' not found or closed.`);
            }
          }
          break;

        default:
          console.warn(`Unhandled signal message type: ${type}`);
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (sessionRole === 'host') {
      hosts.delete(sessionId);
      console.log(`Host disconnected: ${sessionId}`);
    } else if (sessionRole === 'client') {
      clients.delete(sessionId);
      console.log(`Client disconnected: ${sessionId}`);
      // Notify hosts that this client is gone
      broadcastToHosts({ type: 'client-left', clientId: sessionId });
    }
  });

  ws.on('error', (error) => {
    console.error(`Socket error on session ${sessionId}:`, error);
  });
});

// Start the server
server.listen(port, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`   Real-Time Media Server is running on port ${port}    `);
  console.log(`   Client Dashboard: http://localhost:${port}/           `);
  console.log(`   Host Dashboard:   http://localhost:${port}/host.html  `);
  console.log(`=======================================================`);
});
