# Solutions — Obraz Streamer

This document explains the **engineering logic and concrete implementations** used to solve the challenges documented in [CHALLENGES_FACED.md](./CHALLENGES_FACED.md).

Each section maps **Challenge → Solution → Implementation → Outcome**.

---

## 1. WebRTC Signaling & Connection

### Challenge 1.1 — ICE candidates before remote description

**Problem:** `addIceCandidate()` fails if called before remote SDP is applied.

**Engineering logic:**

WebRTC signaling is **async** and **unordered** over WebSocket. The receiver must treat ICE as a **buffered queue**, not a fire-and-forget handler.

**Solution:**

1. On receiving `candidate`, check if `pc.remoteDescription` is set.
2. If **not set** → push candidate into `candidateQueue` array on the peer connection (client) or client record (host).
3. After successful `setRemoteDescription` + answer/offer handling → **flush queue** with sequential `addIceCandidate()` calls.

**Implementation:**

| Side | File | Mechanism |
|------|------|-----------|
| Client | `public/js/client.js` | `pc.candidateQueue = []`; queue in `case 'candidate'`; flush after `case 'answer'` |
| Host | `public/js/host.js` | `candidateQueue` on `connectedClients` entry; flush after answer sent |

**Outcome:** Handshake succeeds regardless of ICE arrival order relative to SDP.

---

### Challenge 1.2 — Track ID mismatch (connected but no/wrong video)

**Problem:** Host used client's local `track.id` to route feeds; remote `ontrack` IDs differ.

**Engineering logic:**

- **`MediaStream.id`** is negotiated as part of the SDP association and is **more stable** for identifying which logical feed (webcam vs screen) a track belongs to.
- **`track.id`** should be a **fallback hint**, not the primary key.
- Always provide a **last-resort heuristic** (track kind + order) so UI degrades gracefully instead of staying blank.

**Solution:**

1. **Client** includes in the `offer` payload:
   - `webcamStreamId` — `webcamCanvasStream.id`
   - `screenStreamId` — `screenCanvasStream.id`
   - Legacy track IDs for backward compatibility
2. **Host** in `pc.ontrack`:
   - Read `event.streams[0].id`
   - Match against `metadata.webcamStreamId` or `metadata.screenStreamId`
   - Fallback: match `event.track.id` to stored track IDs
   - Final fallback: first video → webcam, second video → screen; audio → webcam stream

**Implementation:**

```javascript
// client.js — offer payload includes stream IDs
webcamStreamId: webcamCanvasStream.id,
screenStreamId: screenCanvasStream.id,

// host.js — ontrack prefers stream ID
if (incomingStreamId === metadata.webcamStreamId) { /* webcam */ }
else if (incomingStreamId === metadata.screenStreamId) { /* screen */ }
```

**Outcome:** Host dashboard reliably shows webcam and screen in separate `<video>` elements.

---

### Challenge 1.3 — Host/client startup order

**Problem:** Client may go live before host exists, or host may join after clients.

**Engineering logic:**

Treat presence as **pub/sub events** from the signaling server rather than assuming a fixed boot order.

**Solution:**

| Event | Trigger | Action |
|-------|---------|--------|
| `hosts-available` | Client registers while host(s) online | Client calls `initiateWebRtcConnection()` for each host ID |
| `host-joined` | Host registers while client(s) online | Server notifies each client; client initiates WebRTC |
| `welcome-host` | Host registers | Server sends list of existing client IDs (for logging/UI) |
| `client-joined` | Client registers | Server broadcasts to all hosts |

**Implementation:** `server.js` cases under `register` for both `role === 'host'` and `role === 'client'`.

**Outcome:** Either startup order works. **Recommended UX:** open host first, then client — reduces perceived wait.

---

### Challenge 1.4 — NAT without TURN

**Problem:** P2P fails on restrictive networks.

**Engineering logic:**

STUN discovers public addresses but cannot relay when both sides are behind symmetric NAT or aggressive firewalls. Full fix requires TURN infrastructure.

**Solution (v1):**

- Configure public **STUN** in `RTC_CONFIG` on both client and host:
  ```javascript
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
  ```
- Document as **known limitation**; production path = deploy coturn + credential-based `iceServers`.

**Outcome:** Reliable on localhost and most home/LAN setups; corporate networks may still fail until TURN is added.

---

## 2. Media Capture & Processing

### Challenge 2.1 — Dual permission flow

**Problem:** Mic denial or screen cancel broke entire session.

**Engineering logic:** Treat each track as an **independent capability** with graceful degradation.

**Solution:**

| Failure | Handling |
|---------|----------|
| Webcam audio denied | Catch error; retry `getUserMedia` with `audio: false` |
| Screen share cancelled | `try/catch` on `getDisplayMedia`; reset UI via `resetMediaState()` |
| User stops screen from browser | Listen to `screenTrack.onended` → stop stream, alert user, reset |

**Implementation:** `btnCapture` handler in `public/js/client.js`.

**Outcome:** Video-only webcam still works; screen cancellation returns UI to clean state.

---

### Challenge 2.2 — Two video tracks on one connection

**Problem:** Host cannot tell webcam from screen without metadata.

**Engineering logic:** WebRTC transports anonymous tracks; **application metadata in the signaling offer** is the correct layer for semantic labels.

**Solution:**

- Client sends **two separate `MediaStream` objects** via `addTrack(track, stream)` — one for webcam canvas stream, one for screen canvas stream.
- Offer carries `webcamStreamId`, `screenStreamId`, and display `name`.
- Host builds two local `MediaStream` objects per client and binds them to dedicated `<video>` elements.

**Implementation:** `initiateWebRtcConnection()` (client) + `handleClientOffer()` / `ontrack` (host).

**Outcome:** Semantic separation preserved end-to-end.

---

### Challenge 2.3 — Canvas CPU load

**Problem:** Uncapped draw loops overloaded CPU.

**Engineering logic:** Cap **capture rate** and **input resolution**, not just display refresh.

**Solution:**

1. `canvas.captureStream(30)` — explicit 30 FPS export
2. Ideal constraints: webcam 640×480, screen 1280×720
3. One `requestAnimationFrame` loop per canvas (not multiple timers)
4. Draw only when `video.readyState === HAVE_ENOUGH_DATA`

**Implementation:** `startCanvasLoop()` in `public/js/client.js`.

**Outcome:** Acceptable CPU on typical laptops; watermark remains smooth enough for monitoring.

---

### Challenge 2.4 — Watermark not in transmitted stream

**Problem:** CSS overlays don't encode into WebRTC tracks.

**Engineering logic:** The watermark must be part of the **pixel buffer** that becomes a `MediaStreamTrack`.

**Solution:**

```
hidden <video> (raw capture)
       ↓ drawImage each frame
<canvas> + drawTimestamp() overlay
       ↓ captureStream(30)
MediaStream → RTCPeerConnection
       ↓
webcam audio track re-added from raw getUserMedia stream
```

**Implementation:** `startCanvasLoop()`, `drawTimestamp()`, `webcamCanvasStream.addTrack(audioTrack)`.

**Outcome:** Host always receives burned-in timestamp, REC dot, and WEBCAM/SCREEN label.

---

## 3. Backend & DevOps

### Challenge 3.1 — Port 3000 already in use

**Problem:** Orphan Node process blocks restart.

**Engineering logic:** Separate **environment health** from **application logic** before debugging WebRTC.

**Solution:**

1. Find PID: `netstat -ano | findstr :3000` (Windows)
2. Kill process: `taskkill /PID <pid> /F`
3. Restart: `npm start`
4. Verify signaling: `node test_ws.js`

**Implementation:** `test_ws.js` — minimal WebSocket open/close smoke test.

**Outcome:** Fast recovery during dev; clear signal that port conflict is not a code bug.

---

### Challenge 3.2 — Signaling vs WebRTC failure confusion

**Problem:** Hard to know which layer failed.

**Engineering logic:** **Layered observability** — each tier reports its own state in UI and console.

**Solution:**

| Layer | Observable signal |
|-------|-------------------|
| HTTP/static | Pages load at `/` and `/host.html` |
| WebSocket | `stat-signaling` badge; server console `Host/Client registered` |
| WebRTC | `pc.connectionState`; per-client status badge on host |
| Media | Resolution badges update on `<video>` metadata |

Plus `showVisualError()` overlay for runtime exceptions.

**Outcome:** Failures localize quickly to server, signaling, ICE, or track mapping.

---

### Challenge 3.3 — Blob WebSocket payloads

**Problem:** `JSON.parse(event.data)` fails when data is a Blob.

**Engineering logic:** Normalize input type before parsing.

**Solution:**

```javascript
let rawData = event.data;
if (rawData instanceof Blob) {
  rawData = await rawData.text();
}
const data = JSON.parse(rawData);
```

**Implementation:** Both `client.js` and `host.js` `ws.onmessage` handlers.

**Outcome:** Cross-browser compatible message parsing.

---

## 4. Host Dashboard & Multi-Client UX

### Challenge 4.1 — Dynamic DOM / track race

**Problem:** `ontrack` fires around the same time as card creation.

**Engineering logic:** Idempotent card lifecycle — **one card per `clientId`**, recreate safely, bind streams immediately after card exists.

**Solution:**

1. `createClientCard(clientId, name)` removes existing card with same ID first
2. `connectedClients.set()` before `ontrack` can fire
3. `videoWebcam.srcObject = webcamStream` set in `handleClientOffer` before SDP exchange completes
4. `updateDashboardLayout()` toggles empty state vs grid

**Implementation:** `host.js` — `createClientCard`, `handleClientOffer`, `updateDashboardLayout`.

**Outcome:** Cards appear once; videos bind reliably as tracks arrive.

---

### Challenge 4.2 — Host signaling disconnect

**Problem:** Stale UI after WebSocket drop.

**Engineering logic:** Signaling is the **control plane**; if it dies, tear down **data plane** (peer connections) to avoid zombie UI.

**Solution:**

- `ws.onclose` on host → `clearAllClients()` closes all `RTCPeerConnection`s and removes cards
- Auto-reconnect: `setTimeout(connectSignaling, 3000)`
- Status badge → "Offline"

**Implementation:** `connectSignaling()` close handler in `host.js`.

**Outcome:** Host dashboard reflects true connectivity; reconnect is automatic.

---

### Challenge 4.3 — XSS in display names

**Problem:** Unsanitized names in `innerHTML`.

**Engineering logic:** Never interpolate user input into HTML context without escaping.

**Solution:**

```javascript
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}
```

Used in `createClientCard()` when rendering `${escapeHtml(name)}`.

**Outcome:** Display names render safely as text.

---

## 5. Error Visibility & Debugging

### Challenge 5.1 — Silent async WebRTC failures

**Problem:** Promise rejections invisible to users.

**Engineering logic:** Global error boundaries at the browser page level, plus `.catch()` on critical WebRTC calls.

**Solution:**

1. `window.onerror` → `showVisualError()`
2. `window.onunhandledrejection` → `showVisualError()`
3. Red toast overlay bottom-right with monospace detail
4. `try/catch` around signaling message handler and offer/answer creation

**Implementation:** Top of `client.js` and `host.js`.

**Outcome:** Runtime and WebRTC errors surface immediately during demos and testing.

---

## 6. Solution Reference Table

| Challenge | Solution technique | Primary file(s) |
|-----------|-------------------|-----------------|
| ICE ordering | Candidate queue + flush | `client.js`, `host.js` |
| Track routing | Stream ID metadata + fallbacks | `client.js`, `host.js` |
| Startup order | Presence events from server | `server.js` |
| NAT | STUN (TURN deferred) | `client.js`, `host.js` |
| Mic denial | Audio fallback capture | `client.js` |
| Screen cancel | `onended` + state reset | `client.js` |
| Multi-track | Dual MediaStream + metadata | `client.js`, `host.js` |
| Canvas CPU | 30 FPS capture + resolution caps | `client.js` |
| Watermark | Canvas burn-in pipeline | `client.js` |
| Port in use | Process kill + smoke test | `test_ws.js`, ops docs |
| Blob WS data | `instanceof Blob` guard | `client.js`, `host.js` |
| Dynamic cards | Idempotent DOM + layout toggle | `host.js` |
| Host disconnect | clearAllClients + reconnect | `host.js` |
| XSS | `escapeHtml()` | `host.js` |
| Silent errors | Global error handlers | `client.js`, `host.js` |

---

## 7. Design Principles Applied

These solutions follow consistent engineering principles:

1. **Separate control plane (WebSocket) from data plane (WebRTC SRTP)** — debug each independently.
2. **Never assume message order over async channels** — queue and flush.
3. **Prefer stable identifiers (stream ID) over fragile ones (track ID)** for multi-track apps.
4. **Degrade gracefully per track** — optional audio, heuristic video routing.
5. **Fail visibly** — errors belong in UI, not only in console.
6. **Keep backend dumb** — relay JSON; put intelligence in browsers where media lives.

---

## 8. Related Documents

- [CHALLENGES_FACED.md](./CHALLENGES_FACED.md) — Full list of hurdles
- [ARCHITECTURE_CHOICE.md](./ARCHITECTURE_CHOICE.md) — Protocol and stack rationale
- [METHODOLOGY.md](./METHODOLOGY.md) — End-to-end engineering process
- [README.md](./README.md) — How to run and use the application
