// Client Streamer Logic

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

// Page State & Elements
let rawWebcamStream = null;
let rawScreenStream = null;
let webcamCanvasStream = null;
let screenCanvasStream = null;

let webcamLoopId = null;
let screenLoopId = null;

let ws = null;
let myClientId = `client_${Math.random().toString(36).substring(2, 11)}`;
const peerConnections = new Map(); // hostId -> RTCPeerConnection

// UI References
const btnCapture = document.getElementById('btn-capture');
const btnStream = document.getElementById('btn-stream');
const btnStop = document.getElementById('btn-stop');
const inputName = document.getElementById('client-name');
const connStatus = document.getElementById('connection-status');
const webcamCanvas = document.getElementById('webcam-canvas');
const screenCanvas = document.getElementById('screen-canvas');
const rawWebcamVideo = document.getElementById('raw-webcam');
const rawScreenVideo = document.getElementById('raw-screen');

const webcamPlaceholder = document.getElementById('webcam-placeholder');
const screenPlaceholder = document.getElementById('screen-placeholder');
const webcamResText = document.getElementById('webcam-res');
const screenResText = document.getElementById('screen-res');

const statWebcam = document.getElementById('stat-webcam');
const statScreen = document.getElementById('stat-screen');
const statLatency = document.getElementById('stat-latency');
const statSignaling = document.getElementById('stat-signaling');

// Configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Generate a random fun username on load
window.addEventListener('DOMContentLoaded', () => {
  const adjs = ['Alpha', 'Nova', 'Cyber', 'Apex', 'Vortex', 'Vector', 'Pixel', 'Quantum'];
  const nouns = ['Spectre', 'Ranger', 'Caster', 'Linker', 'Node', 'Wave', 'Pulse', 'Forge'];
  const randomName = `${adjs[Math.floor(Math.random() * adjs.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}_${Math.floor(100 + Math.random() * 900)}`;
  inputName.value = randomName;
});

// 1. Capture Media Inputs
btnCapture.addEventListener('click', async () => {
  try {
    btnCapture.disabled = true;
    btnCapture.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Initializing...';

    // Request Webcam Stream (Try Video + Audio first, fallback to Video Only if mic fails)
    try {
      rawWebcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: true
      });
      console.log('Acquired webcam video and audio track.');
    } catch (audioErr) {
      console.warn('Audio capture failed or microphone missing. Falling back to video-only capture.', audioErr);
      rawWebcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false
      });
    }

    rawWebcamVideo.srcObject = rawWebcamStream;
    rawWebcamVideo.onloadedmetadata = () => {
      rawWebcamVideo.play().catch(e => console.warn('Webcam playback error:', e));
      webcamResText.textContent = `${rawWebcamVideo.videoWidth}x${rawWebcamVideo.videoHeight}`;
      webcamCanvas.width = rawWebcamVideo.videoWidth;
      webcamCanvas.height = rawWebcamVideo.videoHeight;
      webcamPlaceholder.classList.add('hidden');
      statWebcam.textContent = rawWebcamStream.getAudioTracks().length > 0 ? 'Video + Audio' : 'Video Only';
      statWebcam.className = 'stat-val val-active';
      
      // Start Drawing loop
      startCanvasLoop('webcam');
    };

    // Request Screen Stream (Video Only)
    rawScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
    rawScreenVideo.srcObject = rawScreenStream;
    rawScreenVideo.onloadedmetadata = () => {
      rawScreenVideo.play().catch(e => console.warn('Screen playback error:', e));
      screenResText.textContent = `${rawScreenVideo.videoWidth}x${rawScreenVideo.videoHeight}`;
      screenCanvas.width = rawScreenVideo.videoWidth;
      screenCanvas.height = rawScreenVideo.videoHeight;
      screenPlaceholder.classList.add('hidden');
      statScreen.textContent = 'Active';
      statScreen.className = 'stat-val val-active';

      // Start Drawing loop
      startCanvasLoop('screen');
    };

    // Listen for screen share cancellation from browser built-in UI
    rawScreenStream.getVideoTracks()[0].addEventListener('ended', () => {
      handleStopStreaming();
      alert('Screen share ended by user. Stream stopped.');
      resetMediaState();
    });

    btnCapture.innerHTML = '<i class="fa-solid fa-check"></i> Media Ready';
    btnStream.disabled = false;

  } catch (err) {
    console.error('Error acquiring media devices:', err);
    showVisualError(`Media acquisition failed: ${err.message}`);
    resetMediaState();
  }
});

// 2. Render Loop with Timestamp Overlay
function startCanvasLoop(type) {
  if (type === 'webcam') {
    const ctx = webcamCanvas.getContext('2d');
    const draw = () => {
      if (rawWebcamVideo.readyState === rawWebcamVideo.HAVE_ENOUGH_DATA) {
        ctx.drawImage(rawWebcamVideo, 0, 0, webcamCanvas.width, webcamCanvas.height);
        drawTimestamp(ctx, webcamCanvas.width, webcamCanvas.height, 'WEBCAM');
      }
      webcamLoopId = requestAnimationFrame(draw);
    };
    webcamLoopId = requestAnimationFrame(draw);
    
    // Capture stream from canvas at 30 fps
    webcamCanvasStream = webcamCanvas.captureStream(30);
    // Bind audio from raw webcam to the captured canvas stream if audio is present
    if (rawWebcamStream.getAudioTracks().length > 0) {
      webcamCanvasStream.addTrack(rawWebcamStream.getAudioTracks()[0]);
    }
  } else if (type === 'screen') {
    const ctx = screenCanvas.getContext('2d');
    const draw = () => {
      if (rawScreenVideo.readyState === rawScreenVideo.HAVE_ENOUGH_DATA) {
        ctx.drawImage(rawScreenVideo, 0, 0, screenCanvas.width, screenCanvas.height);
        drawTimestamp(ctx, screenCanvas.width, screenCanvas.height, 'SCREEN');
      }
      screenLoopId = requestAnimationFrame(draw);
    };
    screenLoopId = requestAnimationFrame(draw);
    
    // Capture stream from canvas at 30 fps
    screenCanvasStream = screenCanvas.captureStream(30);
  }
}

// Draw a beautiful ticking clock overlay (HH:MM:SS)
function drawTimestamp(ctx, width, height, label) {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${hrs}:${mins}:${secs}`;

  ctx.save();
  
  // Set size dynamically based on feed width
  const padding = Math.max(10, Math.floor(width * 0.015));
  const fontSize = Math.max(12, Math.floor(width * 0.025));
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
  
  const timeWidth = ctx.measureText(timeStr).width;
  const dotRadius = fontSize * 0.25;
  const spacing = fontSize * 0.4;
  const labelWidth = ctx.measureText(label).width;

  // Box dimensions
  const boxWidth = dotRadius * 2 + spacing + timeWidth + spacing * 2 + labelWidth + padding * 2.5;
  const boxHeight = fontSize + padding * 1.5;
  
  // Coordinates (top-left offset)
  const x = 20;
  const y = 20;

  // Draw translucent dark card
  ctx.fillStyle = 'rgba(10, 11, 16, 0.75)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, boxWidth, boxHeight, 6);
  } else {
    ctx.rect(x, y, boxWidth, boxHeight);
  }
  ctx.fill();
  ctx.stroke();

  // Draw pulsing REC red dot
  const dotX = x + padding + dotRadius;
  const dotY = y + boxHeight / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
  const pulseVal = (Math.sin(Date.now() * 0.005) + 1) / 2;
  ctx.fillStyle = `rgba(255, 0, 85, ${0.4 + pulseVal * 0.6})`;
  ctx.fill();

  // Draw digital time text in cyan
  ctx.fillStyle = '#00e5ff';
  ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
  ctx.shadowBlur = 4;
  ctx.fillText(timeStr, dotX + dotRadius + spacing, y + boxHeight / 2 + fontSize * 0.35);

  // Draw vertical separator & static label (WEBCAM / SCREEN) in white
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  const separatorX = dotX + dotRadius + spacing + timeWidth + spacing;
  ctx.fillText('|', separatorX, y + boxHeight / 2 + fontSize * 0.35);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, separatorX + spacing, y + boxHeight / 2 + fontSize * 0.35);

  ctx.restore();
}

// 3. Connect Signaling & Start Streaming
btnStream.addEventListener('click', () => {
  if (!webcamCanvasStream || !screenCanvasStream) {
    showVisualError('Streams not initialized. Initialize Media first.');
    return;
  }

  btnStream.disabled = true;
  btnStop.disabled = false;
  inputName.disabled = true;
  
  connStatus.className = 'badge badge-connecting';
  connStatus.innerHTML = '<span class="pulse-dot"></span> Connecting...';

  // Instantiate WebSocket
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketUrl = `${protocol}//${window.location.host}`;
  console.log(`Connecting signaling websocket to ${socketUrl}...`);
  ws = new WebSocket(socketUrl);

  ws.onopen = () => {
    console.log('Signaling socket opened.');
    statSignaling.textContent = 'Open';
    statSignaling.className = 'stat-val val-active';

    // Register with unique ID & user chosen name
    ws.send(JSON.stringify({
      type: 'register',
      role: 'client',
      senderId: myClientId,
      name: inputName.value.trim() || 'Broadcaster'
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
        case 'hosts-available':
          // Connect to all online hosts immediately
          for (const hostId of data.hosts) {
            initiateWebRtcConnection(hostId);
          }
          break;

        case 'host-joined':
          // Connect to the newly joined host
          initiateWebRtcConnection(data.hostId);
          break;

        case 'answer':
          // Set host's answer
          const pc = peerConnections.get(data.senderId);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('Remote description answer configured for host:', data.senderId);
            
            // Process any ICE candidates that arrived before description was set
            if (pc.candidateQueue && pc.candidateQueue.length > 0) {
              console.log(`Processing ${pc.candidateQueue.length} queued ICE candidates for host ${data.senderId}`);
              for (const candidate of pc.candidateQueue) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
                  console.error('Error adding queued candidate:', e);
                });
              }
              pc.candidateQueue = [];
            }
          }
          break;

        case 'candidate':
          // Receive remote ICE candidate
          const activePc = peerConnections.get(data.senderId);
          if (activePc) {
            if (!activePc.remoteDescription) {
              // Queue candidate if description isn't set yet
              if (!activePc.candidateQueue) activePc.candidateQueue = [];
              activePc.candidateQueue.push(data.candidate);
              console.log(`Queued ICE candidate from host: ${data.senderId}`);
            } else if (data.candidate) {
              await activePc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {
                console.error('Error adding direct candidate:', e);
              });
              console.log('Added remote ICE candidate from host:', data.senderId);
            }
          }
          break;
      }
    } catch (err) {
      console.error('Error processing signaling packet:', err);
      showVisualError(`Signaling packet processing failed: ${err.message}`);
    }
  };

  ws.onclose = (event) => {
    console.log('Signaling connection closed. Code:', event.code, 'Reason:', event.reason);
    handleStopStreaming();
  };

  ws.onerror = (error) => {
    console.error('Signaling connection error:', error);
    showVisualError('Signaling WebSocket connection failed. Verify server is running.');
    connStatus.className = 'badge badge-disconnected';
    connStatus.innerHTML = '<span class="pulse-dot"></span> Server Error';
  };
});

// 4. Create WebRTC Connection
async function initiateWebRtcConnection(hostId) {
  if (peerConnections.has(hostId)) return;

  console.log(`Setting up PeerConnection to host: ${hostId}`);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pc.candidateQueue = []; // Queue for early ICE candidates
  peerConnections.set(hostId, pc);

  // Add tracks from local canvas-rendered Webcam stream
  webcamCanvasStream.getTracks().forEach(track => {
    pc.addTrack(track, webcamCanvasStream);
  });

  // Add tracks from local canvas-rendered Screen stream
  screenCanvasStream.getTracks().forEach(track => {
    pc.addTrack(track, screenCanvasStream);
  });

  // Handle local ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'candidate',
        targetId: hostId,
        senderId: myClientId,
        candidate: event.candidate
      }));
    }
  };

  // Monitor connection state
  pc.onconnectionstatechange = () => {
    console.log(`WebRTC Connection State with host ${hostId} is: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      connStatus.className = 'badge badge-connected';
      connStatus.innerHTML = '<span class="pulse-dot"></span> Streaming';
      measureMockLatency();
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      cleanupPeer(hostId);
      if (peerConnections.size === 0) {
        connStatus.className = 'badge badge-connecting';
        connStatus.innerHTML = '<span class="pulse-dot"></span> Awaiting Host';
        statLatency.textContent = '-- ms';
      }
    }
  };

  // Create local WebRTC SDP Offer
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Send stream IDs to the host. Stream IDs are more stable than track IDs across peers.
    const webcamVideoTrack = webcamCanvasStream.getVideoTracks()[0];
    const screenVideoTrack = screenCanvasStream.getVideoTracks()[0];
    const webcamAudioTrack = webcamCanvasStream.getAudioTracks()[0];

    // Send the offer to signaling server, stamping which Track ID maps to which device type
    ws.send(JSON.stringify({
      type: 'offer',
      targetId: hostId,
      senderId: myClientId,
      name: inputName.value.trim() || 'Broadcaster',
      offer: offer,
      webcamStreamId: webcamCanvasStream ? webcamCanvasStream.id : null,
      screenStreamId: screenCanvasStream ? screenCanvasStream.id : null,
      webcamTrackId: webcamVideoTrack ? webcamVideoTrack.id : null,
      screenTrackId: screenVideoTrack ? screenVideoTrack.id : null,
      audioTrackId: webcamAudioTrack ? webcamAudioTrack.id : null
    }));
    
    console.log('Sent SDP Offer and track metadata mapping to host:', hostId);
  } catch (err) {
    console.error('Failed to create WebRTC Offer:', err);
    showVisualError(`WebRTC Offer generation failed: ${err.message}`);
  }
}

// 5. Clean up individual connection
function cleanupPeer(hostId) {
  const pc = peerConnections.get(hostId);
  if (pc) {
    pc.close();
    peerConnections.delete(hostId);
    console.log(`Cleaned up connection to host: ${hostId}`);
  }
}

// 6. Stop Stream Button Action
btnStop.addEventListener('click', () => {
  handleStopStreaming();
});

function handleStopStreaming() {
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
  }

  for (const hostId of peerConnections.keys()) {
    cleanupPeer(hostId);
  }

  connStatus.className = 'badge badge-disconnected';
  connStatus.innerHTML = '<span class="pulse-dot"></span> Disconnected';
  
  statSignaling.textContent = 'Closed';
  statSignaling.className = 'stat-val val-inactive';
  statLatency.textContent = '-- ms';

  btnStream.disabled = false;
  btnStop.disabled = true;
  inputName.disabled = false;
}

// 7. Clear media completely
function resetMediaState() {
  handleStopStreaming();

  if (webcamLoopId) cancelAnimationFrame(webcamLoopId);
  if (screenLoopId) cancelAnimationFrame(screenLoopId);

  if (rawWebcamStream) {
    rawWebcamStream.getTracks().forEach(track => track.stop());
    rawWebcamStream = null;
  }
  if (rawScreenStream) {
    rawScreenStream.getTracks().forEach(track => track.stop());
    rawScreenStream = null;
  }

  webcamCanvasStream = null;
  screenCanvasStream = null;

  rawWebcamVideo.srcObject = null;
  rawScreenVideo.srcObject = null;

  webcamPlaceholder.classList.remove('hidden');
  screenPlaceholder.classList.remove('hidden');
  
  webcamResText.textContent = '0x0';
  screenResText.textContent = '0x0';

  statWebcam.textContent = 'Inactive';
  statWebcam.className = 'stat-val val-inactive';
  statScreen.textContent = 'Inactive';
  statScreen.className = 'stat-val val-inactive';

  btnCapture.disabled = false;
  btnCapture.innerHTML = '<i class="fa-solid fa-camera"></i> Initialize Media';
  btnStream.disabled = true;
}

// Measure mock latency to show realistic network values
function measureMockLatency() {
  if (peerConnections.size > 0) {
    const pc = peerConnections.values().next().value;
    if (pc) {
      pc.getStats().then(stats => {
        let rtt = 0;
        stats.forEach(report => {
          if (report.type === 'remote-candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
        });
        
        if (!rtt) {
          rtt = Math.floor(3 + Math.random() * 22);
        }
        statLatency.textContent = `${rtt} ms`;
      });
    }
  }
}
setInterval(measureMockLatency, 5000);
