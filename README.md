# Obraz Streamer

A high-performance, real-time media streaming system built from scratch using **WebRTC** for sub-second latency and **HTML5 Canvas** for frame-accurate, live-ticking timestamp overlays. The system supports streaming both the **Webcam** and **Screen Share** feeds simultaneously from multiple clients to a single, centralized **Host Monitoring Dashboard**.

## 🚀 Key Features

*   **Dual-Feed Capture:** Client UI requests permissions and captures webcam and screen share streams concurrently.
*   **Frame-Accurate Watermarking:** Employs HTML5 Canvas rendering loops (`requestAnimationFrame`) to stamp a live, ticking digital clock (`HH:MM:SS`) directly into both video streams before transmission.
*   **WebRTC Peer-to-Peer Streaming:** Utilizes WebRTC (`RTCPeerConnection`) to transport high-definition media streams with ultra-low latency (~10ms–150ms).
*   **Multi-Client Dynamic Grid:** The Host Dashboard registers multiple clients and displays their webcam and screen shares side-by-side in a responsive glassmorphic monitoring grid.
*   **Lightweight Signaling Server:** A Node.js and Express backend combined with standard WebSockets (`ws`) orchestrates SDP handshakes and ICE exchanges without bloated external frameworks.

---

## 🛠️ Architecture Overview


sequenceDiagram
    participant Client as Client (Broadcaster)
    participant Server as Signaling Server (Node.js)
    participant Host as Host (Dashboard)

    Host->>Server: Register as Host (WebSocket)
    Client->>Server: Register as Client (WebSocket)
    Server-->>Client: Send list of online Hosts
    Client->>Client: Capture Webcam & Screen
    Client->>Client: Render canvas frame loops + timestamp
    Client->>Server: Send WebRTC SDP Offer + Stream Metadata
    Server-->>Host: Relay Offer + Metadata
    Host->>Host: Create PeerConnection for Client
    Host->>Server: Send WebRTC SDP Answer
    Server-->>Client: Relay Answer
    Client<->>Host: Exchange ICE Candidates (WebSocket Relay)
    Note over Client,Host: WebRTC Connection Established (SRTP)
    Client-->>Host: Stream audio, webcam video, & screen video


### ⏱️ Timestamp Overlay Logic

Rather than streaming the raw camera and screen sources directly, the client-side system routes the media tracks into offscreen video nodes. An active rendering loop draws the media onto canvases at 30 FPS. The canvas context draws a customized, translucent glassmorphic backdrop overlay containing:
1. A red recording beacon pulsing via `Math.sin(Date.now())`.
2. A ticking clock reading the system's local time (`HH:MM:SS`).
3. Label watermarks (`WEBCAM` and `SCREEN`).

The canvas is then extracted using `canvas.captureStream(30)` to get a modified video stream. For the webcam feed, the original audio track is merged back before transmission.

---

## ⚙️ Setup & Running Instructions

Ensure you have [Node.js](https://nodejs.org/) installed (v16+ recommended).

### 1. Install Dependencies
Open your terminal in the project directory and execute:
```bash
npm install
```

### 2. Launch the Application
Start the signaling and web server by running:
```bash
npm start
```

You should see the following output indicating the server is running:
```
=======================================================
   Real-Time Media Server is running on port 3000    
   Client Dashboard: http://localhost:3000/           
   Host Dashboard:   http://localhost:3000/host.html  
=======================================================
```

---

## 🖥️ Usage Guide

1.  **Open the Host Dashboard:**
    *   Navigate to `http://localhost:3000/host.html` in your browser. You will see an empty monitoring grid waiting for feeds.
2.  **Open the Client Broadcaster(s):**
    *   Navigate to `http://localhost:3000/` (in a separate browser tab or window, or from another computer on the same network).
    *   (Optional) Enter your name in the input box.
    *   Click **Initialize Media**. When prompted by the browser, grant permission for the Webcam and select which window/screen you want to share.
    *   Once initialized, you will see your live feeds side-by-side with watermarked timestamp stamps.
3.  **Go Live:**
    *   Click **Go Live**. The client will establish a WebSocket connection and connect directly via WebRTC.
    *   Check your Host Dashboard. The client's webcam and screen share streams will instantly appear side-by-side in the dashboard grid with minimal latency!
4.  **Multi-Client Streaming:**
    *   Open multiple client tabs at `http://localhost:3000/`. Assign them different names and click **Go Live**.
    *   The Host Dashboard grid will automatically scale to fit all broadcasters.
