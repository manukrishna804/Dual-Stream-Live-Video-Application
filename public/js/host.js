// Host Dashboard Logic

// Global Error Diagnostics overlay
window.onerror = function(message, source, lineno, colno, error) {
  const errorMsg = `${message} (at ${source ? source.split('/').pop() : 'unknown'}:${lineno}:${colno})`;
  showVisualError(errorMsg);
  console.error("Caught global error:", error);
};

window.onunhandledrejection = function(event) {
  const errorMsg = `Unhandled Promise Rejection: ${event.reason}`;
  showVisualError(errorMsg);
  console.error("Caught unhandled rejection:", event.reason);
};

function showVisualError(msg) {
  let container = document.getElementById('error-logger-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'error-logger-container';
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.zIndex = '99999';
    container.style.maxWidth = '400px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }
  
  const alertBox = document.createElement('div');
  alertBox.style.background = 'rgba(255, 0, 85, 0.95)';
  alertBox.style.color = '#fff';
  alertBox.style.padding = '12px 20px';
  alertBox.style.borderRadius = '8px';
  alertBox.style.fontSize = '0.85rem';
  alertBox.style.fontFamily = 'monospace';
  alertBox.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
  alertBox.style.border = '1px solid rgba(255,255,255,0.2)';
  alertBox.style.wordBreak = 'break-all';
  alertBox.innerHTML = `<strong style="display:block;margin-bottom:4px;"><i class="fa-solid fa-triangle-exclamation"></i> RUNTIME ERROR:</strong> ${msg}`;
  
  container.appendChild(alertBox);
  setTimeout(() => alertBox.remove(), 12000);
}

// Host State
let ws = null;
const myHostId = `host_${Math.random().toString(36).substring(2, 11)}`;
const connectedClients = new Map(); // clientId -> { pc, name, webcamStream, screenStream, candidateQueue }
const clientMetadata = new Map();    // clientId -> { webcamStreamId, screenStreamId, webcamTrackId, screenTrackId, audioTrackId, name }

// UI References
const connStatus = document.getElementById('connection-status');
const activeClientCount = document.getElementById('active-client-count');
const emptyState = document.getElementById('empty-state');
const clientsGrid = document.getElementById('clients-grid');

// Configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Start WebSocket connection to signaling server
function connectSignaling() {
  connStatus.className = 'badge badge-connecting';
  connStatus.innerHTML = '<span class="pulse-dot"></span> Connecting...';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketUrl = `${protocol}//${window.location.host}`;
  console.log(`Connecting signaling websocket to ${socketUrl}...`);
  ws = new WebSocket(socketUrl);

  ws.onopen = () => {
    console.log('Host signaling socket opened.');
    connStatus.className = 'badge badge-connected';
    connStatus.innerHTML = '<span class="pulse-dot"></span> Online';

    // Register as host
    ws.send(JSON.stringify({
      type: 'register',
      role: 'host',
      senderId: myHostId
    }));
  };

  ws.onmessage = async (event) => {
    try {
      let rawData = event.data;
      if (rawData instanceof Blob) {
        rawData = await rawData.text();
      }
      const data = JSON.parse(rawData);
      console.log('Received signal:', data.type, 'from:', data.senderId);

      switch (data.type) {
        case 'welcome-host':
          console.log('Welcomed by server. Initial clients:', data.clients);
          break;

        case 'client-joined':
          console.log(`New client joined: ${data.clientId} (${data.name})`);
          break;

        case 'offer':
          // Set client metadata mapping (stamping track UUIDs)
          clientMetadata.set(data.senderId, {
            webcamStreamId: data.webcamStreamId,
            screenStreamId: data.screenStreamId,
            webcamTrackId: data.webcamTrackId,
            screenTrackId: data.screenTrackId,
            audioTrackId: data.audioTrackId,
            name: data.name || 'Anonymous User'
          });
          
          await handleClientOffer(data.senderId, data.offer);
          break;

        case 'candidate':
          // Handle remote ICE candidate
          const client = connectedClients.get(data.senderId);
          if (client && client.pc) {
            if (!client.pc.remoteDescription) {
              // Queue candidate if description isn't set yet
              if (!client.candidateQueue) client.candidateQueue = [];
              client.candidateQueue.push(data.candidate);
              console.log(`Queued ICE candidate from client: ${data.senderId}`);
            } else if (data.candidate) {
              await client.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {
                console.error('Error adding direct candidate:', e);
              });
              console.log(`Added remote ICE candidate from client: ${data.senderId}`);
            }
          }
          break;

        case 'client-left':
          console.log(`Client left: ${data.clientId}`);
          removeClient(data.clientId);
          break;
      }
    } catch (err) {
      console.error('Error handling signaling message:', err);
      showVisualError(`Signaling message error: ${err.message}`);
    }
  };

  ws.onclose = (event) => {
    console.log('Host signaling socket closed. Code:', event.code, 'Reason:', event.reason, 'Reconnecting in 3s...');
    connStatus.className = 'badge badge-disconnected';
    connStatus.innerHTML = '<span class="pulse-dot"></span> Offline';
    
    // Clear all streams on disconnect
    clearAllClients();
    
    setTimeout(connectSignaling, 3000);
  };

  ws.onerror = (error) => {
    console.error('Host socket error:', error);
    showVisualError('Host WebSocket connection error.');
  };
}

// Handle incoming offer from client
async function handleClientOffer(clientId, offerSdp) {
  // If we already have an existing connection to this client, close and rebuild
  if (connectedClients.has(clientId)) {
    removeClient(clientId);
  }

  const meta = clientMetadata.get(clientId);
  const clientName = meta ? meta.name : 'Broadcaster';

  console.log(`Creating PeerConnection for client: ${clientId}`);
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // Set up local MediaStream instances for output video tags
  const webcamStream = new MediaStream();
  const screenStream = new MediaStream();

  connectedClients.set(clientId, { 
    pc, 
    name: clientName,
    webcamStream,
    screenStream,
    candidateQueue: []
  });
  
  updateDashboardLayout();

  // Create card UI structure
  createClientCard(clientId, clientName);

  // Link local MediaStream objects to visual <video> sources
  const videoWebcam = document.getElementById(`webcam-video-${clientId}`);
  const videoScreen = document.getElementById(`screen-video-${clientId}`);
  if (videoWebcam) videoWebcam.srcObject = webcamStream;
  if (videoScreen) videoScreen.srcObject = screenStream;

  // Bind WebRTC track listener
  pc.ontrack = (event) => {
    console.log(`Received track event for client ${clientId}: ${event.track.kind} (id: ${event.track.id})`);
    
    const clientData = connectedClients.get(clientId);
    const metadata = clientMetadata.get(clientId);
    const incomingStream = event.streams && event.streams.length > 0 ? event.streams[0] : null;
    const incomingStreamId = incomingStream ? incomingStream.id : null;
    if (!clientData || !metadata) {
      console.warn(`No metadata or connection reference found for client: ${clientId}`);
      return;
    }

    // Prefer stream-id mapping for stability. Track IDs are not guaranteed to match across peers.
    if (incomingStreamId && metadata.webcamStreamId && incomingStreamId === metadata.webcamStreamId) {
      clientData.webcamStream.addTrack(event.track);
      console.log(`Mapped track to Webcam stream by streamId (${incomingStreamId}) for client: ${clientId}`);
      
      // Update dimensions UI once track begins rendering
      if (videoWebcam && event.track.kind === 'video') {
        videoWebcam.play().catch(e => console.warn('Webcam playback error:', e));
        videoWebcam.onloadedmetadata = () => {
          document.getElementById(`webcam-res-${clientId}`).textContent = `${videoWebcam.videoWidth}x${videoWebcam.videoHeight}`;
        };
      } else if (videoWebcam && event.track.kind === 'audio') {
        videoWebcam.play().catch(e => console.warn('Webcam audio playback error:', e));
      }
    } else if (incomingStreamId && metadata.screenStreamId && incomingStreamId === metadata.screenStreamId) {
      clientData.screenStream.addTrack(event.track);
      console.log(`Mapped track to Screen stream by streamId (${incomingStreamId}) for client: ${clientId}`);
      
      if (videoScreen && event.track.kind === 'video') {
        videoScreen.play().catch(e => console.warn('Screen playback error:', e));
        videoScreen.onloadedmetadata = () => {
          document.getElementById(`screen-res-${clientId}`).textContent = `${videoScreen.videoWidth}x${videoScreen.videoHeight}`;
        };
      }
    } else if (event.track.id === metadata.webcamTrackId) {
      clientData.webcamStream.addTrack(event.track);
      console.log(`Successfully mapped Webcam Video Track (id: ${event.track.id}) for client: ${clientId}`);
      
      // Update dimensions UI once track begins rendering
      if (videoWebcam) {
        videoWebcam.play().catch(e => console.warn('Webcam playback error:', e));
        videoWebcam.onloadedmetadata = () => {
          document.getElementById(`webcam-res-${clientId}`).textContent = `${videoWebcam.videoWidth}x${videoWebcam.videoHeight}`;
        };
      }
    } else if (event.track.id === metadata.screenTrackId) {
      clientData.screenStream.addTrack(event.track);
      console.log(`Successfully mapped Screen Video Track (id: ${event.track.id}) for client: ${clientId}`);
      
      if (videoScreen) {
        videoScreen.play().catch(e => console.warn('Screen playback error:', e));
        videoScreen.onloadedmetadata = () => {
          document.getElementById(`screen-res-${clientId}`).textContent = `${videoScreen.videoWidth}x${videoScreen.videoHeight}`;
        };
      }
    } else if (event.track.id === metadata.audioTrackId || event.track.kind === 'audio') {
      clientData.webcamStream.addTrack(event.track);
      console.log(`Successfully mapped Webcam Audio Track (id: ${event.track.id}) for client: ${clientId}`);
      if (videoWebcam) {
        videoWebcam.play().catch(e => console.warn('Webcam audio playback error:', e));
      }
    } else {
      console.warn(`Track ${event.track.id} did not match metadata map. Applying fallback mapping.`, metadata);
      if (event.track.kind === 'video') {
        if (clientData.webcamStream.getVideoTracks().length === 0) {
          clientData.webcamStream.addTrack(event.track);
        } else {
          clientData.screenStream.addTrack(event.track);
        }
      } else if (event.track.kind === 'audio') {
        clientData.webcamStream.addTrack(event.track);
      }
    }
  };

  // ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'candidate',
        targetId: clientId,
        senderId: myHostId,
        candidate: event.candidate
      }));
    }
  };

  // Monitor connection state
  pc.onconnectionstatechange = () => {
    console.log(`Connection state for client ${clientId}: ${pc.connectionState}`);
    const badge = document.getElementById(`status-badge-${clientId}`);
    
    if (badge) {
      if (pc.connectionState === 'connected') {
        badge.className = 'badge badge-connected';
        badge.innerHTML = '<span class="pulse-dot"></span> Streaming';
      } else if (pc.connectionState === 'connecting') {
        badge.className = 'badge badge-connecting';
        badge.innerHTML = '<span class="pulse-dot"></span> Connecting';
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        badge.className = 'badge badge-disconnected';
        badge.innerHTML = '<span class="pulse-dot"></span> Interrupted';
      }
    }
  };

  // Accept offer and send answer
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({
      type: 'answer',
      targetId: clientId,
      senderId: myHostId,
      answer: answer
    }));
    console.log(`Sent WebRTC Answer to client: ${clientId}`);

    // Process candidate queue once remote description is successfully configured
    const clientRecord = connectedClients.get(clientId);
    if (clientRecord && clientRecord.candidateQueue && clientRecord.candidateQueue.length > 0) {
      console.log(`Processing ${clientRecord.candidateQueue.length} queued ICE candidates for client: ${clientId}`);
      for (const candidate of clientRecord.candidateQueue) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
          console.error('Error adding queued candidate:', e);
        });
      }
      clientRecord.candidateQueue = [];
    }
  } catch (err) {
    console.error(`Error completing WebRTC handshake for client ${clientId}:`, err);
    showVisualError(`WebRTC Handshake failed: ${err.message}`);
  }
}

// UI: Generate Client Card
function createClientCard(clientId, name) {
  const existingCard = document.getElementById(`client-card-${clientId}`);
  if (existingCard) {
    existingCard.remove();
  }

  const card = document.createElement('div');
  card.className = 'client-card';
  card.id = `client-card-${clientId}`;
  card.innerHTML = `
    <div class="client-card-header">
      <div class="client-info">
        <i class="fa-solid fa-user-astronaut"></i>
        <span class="client-name">${escapeHtml(name)}</span>
        <span class="client-id-badge">(${clientId})</span>
      </div>
      <span class="badge badge-connecting" id="status-badge-${clientId}">
        <span class="pulse-dot"></span> Negotiating
      </span>
    </div>
    <div class="client-feeds">
      <!-- Webcam -->
      <div class="host-video-card">
        <div class="host-video-header">
          <span><i class="fa-solid fa-user"></i> WEBCAM</span>
          <span class="video-res-badge" id="webcam-res-${clientId}">--</span>
        </div>
        <div class="video-container">
          <video id="webcam-video-${clientId}" autoplay playsinline muted controls></video>
        </div>
      </div>
      <!-- Screen -->
      <div class="host-video-card">
        <div class="host-video-header">
          <span><i class="fa-solid fa-desktop"></i> SCREEN SHARE</span>
          <span class="video-res-badge" id="screen-res-${clientId}">--</span>
        </div>
        <div class="video-container">
          <video id="screen-video-${clientId}" autoplay playsinline muted controls></video>
        </div>
      </div>
    </div>
  `;

  clientsGrid.appendChild(card);
}

// Clean up client streams
function removeClient(clientId) {
  const client = connectedClients.get(clientId);
  if (client) {
    if (client.pc) {
      client.pc.close();
    }
    connectedClients.delete(clientId);
  }
  
  clientMetadata.delete(clientId);

  const card = document.getElementById(`client-card-${clientId}`);
  if (card) {
    card.remove();
  }

  updateDashboardLayout();
}

function clearAllClients() {
  for (const clientId of connectedClients.keys()) {
    removeClient(clientId);
  }
}

// Refresh empty state & indicators
function updateDashboardLayout() {
  const count = connectedClients.size;
  activeClientCount.textContent = count;

  if (count === 0) {
    emptyState.classList.remove('hidden');
    clientsGrid.classList.add('hidden');
  } else {
    emptyState.classList.add('hidden');
    clientsGrid.classList.remove('hidden');
  }
}

// Helper to escape HTML tags in username input to prevent XSS
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// Initialize on page load
connectSignaling();
