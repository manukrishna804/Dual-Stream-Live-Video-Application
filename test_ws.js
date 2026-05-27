const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('TEST SUCCESS: Connected to signaling server!');
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('TEST FAILED: Could not connect to signaling server:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('TEST TIMEOUT: Connection timed out.');
  process.exit(1);
}, 2000);
