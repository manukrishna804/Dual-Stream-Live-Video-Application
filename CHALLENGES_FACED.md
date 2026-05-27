# Challenges Faced — Obraz Streamer

This document details the **specific technical hurdles** encountered while building Obraz Streamer, organized by subsystem.

For how each challenge was resolved, see [SOLUTIONS.md](./SOLUTIONS.md).

---

## 1. WebRTC Signaling & Connection

### 1.1 ICE candidates arriving before remote description

During WebRTC handshake, ICE candidates were sometimes delivered over WebSocket **before** `setRemoteDescription()` finished on the receiving peer.

**Symptoms:**

- Console errors on `addIceCandidate()`
- Connection stuck in `connecting` or moving to `failed`
- Intermittent success depending on network timing

**Root cause:** WebSocket does not guarantee ordering relative to async SDP operations. ICE gathering starts immediately after `setLocalDescription()` and can outpace offer/answer processing.

---

### 1.2 Client and host appearing connected but no video

Signaling WebSocket showed **Open**, server logs showed successful `register`, and SDP offer/answer exchanged — yet the host dashboard showed **blank video elements** or feeds on the wrong `<video>` tag.

**Symptoms:**

- Host client card appeared with "Negotiating" or "Streaming" badge
- Webcam slot empty while screen played (or vice versa)
- Server relay logs looked healthy

**Root cause:** Host mapped incoming tracks using **`track.id`** values sent in the client's offer. WebRTC **does not guarantee track IDs are identical** on both sides of a peer connection. The host's `ontrack` event often reports different IDs than the client stamped locally.

---

### 1.3 Host–client startup order dependency

Behavior differed depending on whether the host dashboard or client broadcaster connected first.

**Symptoms:**

- Client clicked **Go Live** before host was online → waited indefinitely unless host joined later
- Host opened after client sometimes required client to reconnect
- Confusion during manual testing about "who connects to whom"

**Root cause:** Presence is event-driven (`hosts-available` vs `host-joined`). The system handles both orders in code, but timing gaps expose race windows in the tester workflow.

---

### 1.4 NAT traversal without TURN

On some networks, peer connection never reaches `connected` even with valid signaling.

**Symptoms:**

- ICE state stuck at `checking`
- Works on `localhost`, fails on corporate Wi‑Fi or symmetric NAT

**Root cause:** Only **STUN** is configured. Strict firewalls and symmetric NAT often require a **TURN relay**, which was out of scope for v1.

---

## 2. Media Capture & Processing

### 2.1 Dual permission flow (camera + screen)

The client must obtain **two separate browser permissions**: camera/mic via `getUserMedia` and screen/window via `getDisplayMedia`.

**Symptoms:**

- User denies microphone → entire capture failed in early versions
- User cancels screen picker → partial state left in UI
- User stops screen share from browser UI → client still thought it was live

**Root cause:** Independent permission lifecycles; failure in one path must not corrupt the other, and screen track `ended` must propagate to streaming state.

---

### 2.2 Sending two video tracks on one peer connection

Each client sends **webcam video**, **screen video**, and optionally **audio** on a single `RTCPeerConnection`.

**Symptoms:**

- Host received tracks but could not distinguish which was webcam vs screen
- Both feeds merged into one `<video>` element
- Audio attached to wrong visual feed

**Root cause:** Multi-track WebRTC requires explicit application-level metadata; the browser does not label tracks as "webcam" or "screen" for the remote peer.

---

### 2.3 Canvas rendering performance

Drawing full-resolution webcam and screen frames every animation frame, plus watermark graphics, consumed significant CPU.

**Symptoms:**

- Fan spin on laptops during long sessions
- Dropped frames in captured stream
- UI jank when both canvases ran simultaneously

**Root cause:** `requestAnimationFrame` runs as fast as the display allows unless capped; `captureStream()` without an FPS limit can amplify work.

---

### 2.4 Watermark must appear on remote host, not just local preview

Initial experiments used CSS overlays on the client's preview `<video>`.

**Symptoms:**

- Client saw timestamp; host did not
- Requirement for "frame-accurate watermark on transmitted stream" was not met

**Root cause:** CSS overlays are a presentation layer — they are **not encoded** into the `MediaStreamTrack` sent over WebRTC.

---

## 3. Backend & DevOps

### 3.1 Port already in use (`EADDRINUSE`)

During development, restarting the server frequently failed with:

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
```

**Symptoms:**

- `npm start` crashes immediately
- Browser still loads old app from orphan process
- Debugging against stale server code

**Root cause:** Previous `node server.js` process not terminated (Ctrl+C missed, background terminal, IDE task still running).

---

### 3.2 Distinguishing signaling failures from WebRTC failures

Early debugging conflated "server down" with "WebRTC broken."

**Symptoms:**

- Blank host dashboard with no clear error
- Time wasted inspecting SDP when WebSocket never opened
- Hard to tell if issue was Node, browser permissions, or ICE

**Root cause:** No layered health checks; errors surfaced only in browser console.

---

### 3.3 WebSocket message parsing edge cases

Some environments deliver WebSocket payloads as `Blob` rather than string.

**Symptoms:**

- `JSON.parse` failures on `event.data`
- Signaling handler silently failing in certain browsers

**Root cause:** Assumption that `event.data` is always a string.

---

## 4. Host Dashboard & Multi-Client UX

### 4.1 Dynamic DOM for unknown number of clients

The host page starts with an empty grid; client cards are created at runtime when offers arrive.

**Symptoms:**

- Race between `createClientCard()` and `ontrack` binding video `srcObject`
- Duplicate cards if same client re-offered after reconnect
- Empty state not hiding when first client connected

**Root cause:** Async WebRTC events interleave with DOM creation; no idempotent card lifecycle in early builds.

---

### 4.2 Host signaling disconnect during long sessions

If the host WebSocket dropped, all client video could freeze while UI still showed old cards.

**Symptoms:**

- "Offline" badge on host header
- Stale client cards with frozen last frame
- Manual page refresh required

**Root cause:** WebRTC peer connections outlive signaling socket; no unified teardown on signaling loss initially.

---

### 4.3 XSS via broadcaster display name

Client-supplied names are rendered in host dashboard HTML.

**Symptoms:**

- Potential script injection if name contains `<script>` or event handlers

**Root cause:** Dynamic `innerHTML` insertion without sanitization.

---

## 5. Error Visibility & Debugging

### 5.1 Silent async failures in WebRTC promises

Many WebRTC APIs return promises (`setRemoteDescription`, `addIceCandidate`, `createOffer`) that failed without user-visible feedback.

**Symptoms:**

- Developers saw errors only in DevTools
- End users saw frozen "Connecting..." badge

**Root cause:** No global unhandled rejection handler or on-screen error overlay in early iterations.

---

## 6. Challenge Summary Matrix

| # | Area | Challenge | Severity |
|---|------|-----------|----------|
| 1.1 | WebRTC | ICE before remote description | High |
| 1.2 | WebRTC | Track ID mismatch across peers | **Critical** |
| 1.3 | WebRTC | Host/client startup order | Medium |
| 1.4 | Network | No TURN for strict NAT | Medium (env-dependent) |
| 2.1 | Media | Dual permission failures | Medium |
| 2.2 | Media | Multi-track routing on host | **Critical** |
| 2.3 | Media | Canvas CPU load | Medium |
| 2.4 | Media | Watermark not in encoded stream | High |
| 3.1 | Backend | Port 3000 already in use | Low (dev friction) |
| 3.2 | Backend | Signaling vs WebRTC confusion | Medium |
| 3.3 | Backend | Blob WebSocket payloads | Low |
| 4.1 | Host UI | Dynamic card / track race | Medium |
| 4.2 | Host UI | Signaling disconnect cleanup | Medium |
| 4.3 | Host UI | XSS in display names | Medium (security) |
| 5.1 | DX | Silent promise failures | Medium |

---

## 7. Related Documents

- [SOLUTIONS.md](./SOLUTIONS.md) — Engineering solutions for each challenge above
- [ARCHITECTURE_CHOICE.md](./ARCHITECTURE_CHOICE.md) — Why WebRTC, WebSocket, and this backend shape were chosen
- [METHODOLOGY.md](./METHODOLOGY.md) — Full build phases and testing strategy
