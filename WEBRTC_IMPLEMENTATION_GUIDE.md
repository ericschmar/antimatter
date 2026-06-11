# WebRTC Implementation Guide - Option A: Direct Calls via Mattermost Signaling

Complete implementation guide for adding serverless voice/video calls to Antimatter.

## ⚠️ Critical Fixes Applied (v2.0)

This guide includes fixes for production issues found in v1.0:

1. **✅ ICE Candidate Buffering** - Prevents race condition where ICE candidates arrive before setRemoteDescription
2. **✅ ICE Candidate Batching** - Reduces Mattermost API load by batching candidates (prevents rate limiting)
3. **✅ Device Switching** - Uses `replaceTrack()` API to properly update PeerConnection during active calls
4. **✅ Remote Stream Assembly** - Waits for all tracks (audio + video) before emitting stream
5. **✅ Multi-Tab Coordination** - Uses BroadcastChannel to prevent duplicate calls across browser tabs
6. **✅ Session Recovery** - Detects orphaned sessions after page refresh and prompts user
7. **✅ Sender Validation** - Validates signaling message sender to prevent spoofing
8. **✅ ICE Restart** - Handles network changes (WiFi → cellular) with automatic ICE restart
9. **✅ Memory Leak Prevention** - Properly removes event listeners in cleanup
10. **✅ Complete Phase 3 UI** - Includes full React components (CallContext, buttons, toasts, panel)

**Timeline updated**: 6-8 weeks for production-ready implementation (was 3-4 weeks)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Foundation](#phase-1-foundation)
3. [Phase 2: WebRTC Core](#phase-2-webrtc-core)
4. [Phase 3: UI Components](#phase-3-ui-components)
5. [Phase 4: Integration](#phase-4-integration)
6. [Phase 5: Polish & Testing](#phase-5-polish--testing)
7. [Deployment Checklist](#deployment-checklist)

---

## Architecture Overview

### 📋 Quick Summary

**What This Guide Builds:**
- Direct peer-to-peer voice/video calls between Antimatter users
- Uses Mattermost DM channels for signaling (connection setup)
- No external servers required (except STUN for NAT traversal)
- Audio/video streams never touch Mattermost server (peer-to-peer only)

**Key Trade-offs:**
- ✅ No external call server needed
- ✅ Perfect for VPN/internal environments
- ✅ Full control over implementation
- ❌ Regular Mattermost users see signaling messages (5-10 per call)
- ❌ 6-8 weeks development time
- ❌ You maintain the WebRTC code

**Best For:**
- Internal/VPN environments
- All users have Antimatter
- You want full control
- You have development resources

**Not Ideal For:**
- Mixed user base (Antimatter + regular Mattermost)
- Need it working this week
- External/public users
- Want hands-off maintenance

### ⚠️ IMPORTANT: VPN Considerations

**Since Antimatter runs behind a VPN, you have a significant advantage:**
- All clients are on the same private network
- STUN servers should work for most connections
- TURN servers may not be needed (test first!)
- NAT traversal is simplified within VPN

**However, be aware:**
- Mobile users disconnecting from VPN will drop calls
- Remote workers on different VPNs may still need TURN
- Test thoroughly with your actual VPN topology

### 🚨 CRITICAL: What Regular Mattermost Users Will See

**This implementation "hijacks" Mattermost DMs for signaling. Here's what happens to users NOT using Antimatter:**

#### What They'll See:

**On Desktop/Web Mattermost:**
```
[Your Name]: 📞 Voice call
[Your Name]: 📞 Call connecting...
[Your Name]: 📞 Call connecting...
[Your Name]: 📞 Call connecting...
[Your Name]: 📞 Call answered
[Your Name]: 📞 Call ended
```

- Each signaling message (offer, answer, ICE candidates batches) appears as a post
- Posts have human-readable text (e.g., "📞 Voice call", "📞 Call connecting...")
- They can't interact with these messages (no buttons)
- Messages appear in chronological order in the DM
- **Channel is polluted with 5-10 technical messages per call**

**On Mobile Mattermost:**
- Mobile push notifications for each signaling message (very annoying!)
- Same message pollution in the DM thread
- Users might think you're spamming them

**In Search Results:**
- Signaling messages appear when searching the channel
- Clutters search with "📞 Call connecting..." messages

#### Why This Happens:

Custom post types (`custom_webrtc_call`) are still:
- ✅ Stored in Mattermost database
- ✅ Sent via WebSocket to all clients
- ✅ Visible in channel history
- ✅ Trigger mobile notifications
- ❌ NOT hidden from regular Mattermost clients

**Custom post types only hide special rendering in the web UI, but the post still exists.**

#### Mitigation Options:

**Option 1: Accept the Noise (Simplest)**
- Document this as "known behavior"
- Users learn to ignore call signaling messages
- Only affects DM channels with Antimatter users

**Option 2: Suppress Notifications on Mattermost Server**
```javascript
// Mattermost server plugin to suppress notifications
// for custom_webrtc_call posts
exports.MessageWillBePosted = async (post) => {
  if (post.type === 'custom_webrtc_call') {
    // Don't send push notifications
    return { post: { ...post, props: { ...post.props, disable_notifications: true } } };
  }
  return { post };
};
```

**Option 3: Hidden System Messages (Better)**

Instead of regular posts, use Mattermost system messages:
```typescript
const post = {
  channel_id: channelId,
  message: '', // Empty message
  type: 'system_webrtc_signal',
  props: {
    from_webhook: 'true', // Suppresses mobile notifications
    ...signalingMessage,
  },
};
```

System messages:
- ✅ Don't trigger mobile notifications
- ✅ Less prominent in UI
- ❌ Still visible in channel history

**Option 4: Ephemeral Posts (Best, if supported)**

Use Mattermost ephemeral messages (visible only to sender):
```typescript
await mattermostApi.createEphemeralPost({
  user_id: recipientId,
  post: {
    channel_id: channelId,
    message: JSON.stringify(signalingMessage),
  },
});
```

- ✅ Only visible to recipient
- ✅ Not stored in database
- ✅ No channel pollution
- ❌ Requires server plugin or API support

**Option 5: Use WebSocket Custom Events (Ideal)**

Skip Mattermost posts entirely, use raw WebSocket:
```typescript
// Send custom WebSocket event (not a post)
websocket.send(JSON.stringify({
  action: 'custom_event',
  seq: 1,
  data: {
    event: 'webrtc_signal',
    data: signalingMessage,
    broadcast: {
      user_id: recipientId,
    },
  },
}));
```

- ✅ No posts created
- ✅ No channel pollution
- ✅ No notifications
- ❌ Requires Mattermost server plugin to relay events
- ❌ More complex implementation

#### Recommended Approach:

**For VPN/Internal Use:**
1. Start with **Option 1** (accept the noise) - simplest to implement
2. Add **Option 3** (system messages + `from_webhook`) to suppress notifications
3. Users should understand these are "technical messages" for calls
4. Most users will have Antimatter, so they won't see the messages in the UI

**For Production/External Use:**
1. Implement **Option 5** (WebSocket custom events) with a Mattermost plugin
2. Falls back to **Option 3** if plugin not available

#### Testing with Regular Mattermost Users:

Before deploying, test with a regular Mattermost user:

1. Install standard Mattermost desktop/mobile client
2. Have Antimatter user call this regular user
3. Check their experience:
   - Do they see signaling messages?
   - Do they get notifications?
   - Is the DM channel polluted?
4. Document expected behavior for mixed users

#### Visual Comparison:

```
┌────────────────────────────────────────────────────────────────┐
│           ANTIMATTER USER                                       │
├────────────────────────────────────────────────────────────────┤
│ DM with Bob                                                     │
│                                                                 │
│ You: Hey, can we discuss the project?                          │
│ Bob: Sure, give me 5 minutes                                   │
│                                                                 │
│ [User clicks call button]                                      │
│                                                                 │
│ ╔═══════════════════════════════════════╗                      │
│ ║  🔊 Call with Bob          00:45    ║  ← Active call panel   │
│ ║  [🔇] [📹] [❌]                      ║                         │
│ ╚═══════════════════════════════════════╝                      │
│                                                                 │
│ [No signaling messages visible - hidden by Antimatter]         │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│           REGULAR MATTERMOST USER (Desktop)                     │
├────────────────────────────────────────────────────────────────┤
│ DM with Alice                                                   │
│                                                                 │
│ Alice: Hey, can we discuss the project?                        │
│ You: Sure, give me 5 minutes                                   │
│                                                                 │
│ Alice: 📞 Voice call                    ← Sees this!           │
│ Alice: 📞 Call connecting...            ← And this!            │
│ Alice: 📞 Call connecting...            ← And this!            │
│ Alice: 📞 Call connecting...            ← And this!            │
│ Alice: 📞 Call ended                    ← And this!            │
│                                                                 │
│ You: Wait, what was that?                                      │
│ Alice: Sorry, that's our internal calling system.              │
│        If you install Antimatter, you won't see those!         │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│           REGULAR MATTERMOST USER (Mobile)                      │
├────────────────────────────────────────────────────────────────┤
│ 📱 Notification: Alice sent a message                          │
│ 📱 Notification: Alice sent a message                          │
│ 📱 Notification: Alice sent a message    ← VERY ANNOYING!     │
│ 📱 Notification: Alice sent a message                          │
│ 📱 Notification: Alice sent a message                          │
│                                                                 │
│ [User opens app to see "📞 Call connecting..." spam]           │
└────────────────────────────────────────────────────────────────┘
```

#### Sample Message Flow:

**Call Sequence (What Non-Antimatter User Sees):**
```
You: Hey, can we discuss the project?
Them: Sure, give me 5 minutes

[Antimatter user initiates call]

Them: 📞 Voice call
Them: 📞 Call connecting...
Them: 📞 Call connecting...
Them: 📞 Call ended

You: Wait, what was that?
Them: Sorry, that's our internal calling system. 
      If you install Antimatter, you won't see those messages!
```

#### User Education Required:

**If you deploy this, you MUST:**

1. **Document the behavior** in your user guide
2. **Train internal users** to expect these messages
3. **Add a help command** or info message:
   ```
   /webrtc-help
   
   Response:
   "When Antimatter users make calls, you may see technical 
   messages like '📞 Call connecting...' in the chat. 
   These are normal and can be ignored. 
   Install Antimatter to make calls yourself and hide these messages."
   ```
4. **Consider an auto-response** for the first call with each user:
   ```typescript
   // First time calling a non-Antimatter user
   if (isFirstCallWithUser(userId)) {
     await sendInfoMessage(channelId, 
       "Note: Since you're using Antimatter's calling feature, " +
       "the other user may see some technical messages. " +
       "They can ignore these or install Antimatter to join calls."
     );
   }
   ```

#### Impact Assessment:

**Low Impact (acceptable):**
- ✅ Internal-only deployment where all users have Antimatter
- ✅ Users are tech-savvy and understand the system
- ✅ VPN environment with controlled user base
- ✅ You add `from_webhook: 'true'` to suppress mobile notifications

**High Impact (problematic):**
- ❌ Mixed user base (some Mattermost, some Antimatter)
- ❌ External users or clients on Mattermost
- ❌ Mobile-heavy user base (notification spam)
- ❌ High-volume calling (dozens per day)

**Your Situation (VPN/Internal):**
- Likely **LOW IMPACT** since it's internal use
- Most users probably have Antimatter
- VPN suggests controlled environment
- Adding `from_webhook: 'true'` mitigates most annoyance

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User A (Initiator)                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Click "Call" on User B's profile                         │
│ 2. CallManager.initiateCall()                               │
│    - Get microphone permission                              │
│    - Create RTCPeerConnection                               │
│    - Add local audio track                                  │
│    - Generate SDP offer                                     │
│ 3. Send offer via Mattermost DM (custom post type)         │
└─────────────────────────────────────────────────────────────┘
                            ↓
                  Mattermost Server
                  (WebSocket relay)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    User B (Receiver)                        │
├─────────────────────────────────────────────────────────────┤
│ 1. Receive WebSocket event with call offer                 │
│ 2. Show "Incoming Call" notification                        │
│ 3. User clicks "Accept"                                     │
│ 4. CallManager.handleOffer()                                │
│    - Get microphone permission                              │
│    - Create RTCPeerConnection                               │
│    - Set remote description (offer)                         │
│    - Add local audio track                                  │
│    - Generate SDP answer                                    │
│ 5. Send answer via Mattermost DM                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
                  Mattermost Server
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    User A (Initiator)                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Receive answer via WebSocket                            │
│ 2. CallManager.handleAnswer()                               │
│    - Set remote description (answer)                        │
│ 3. ICE candidates start flowing both ways                   │
│ 4. Connection established!                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
                   ┌───────────────┐
                   │  Direct P2P   │
                   │  Audio Stream │
                   │  (no server)  │
                   └───────────────┘
```

### File Structure

```
src/
├── mainview/
│   ├── webrtc/
│   │   ├── CallManager.ts          # Core WebRTC logic
│   │   ├── CallSignaling.ts        # Mattermost signaling handler
│   │   ├── MediaDevices.ts         # Device enumeration/selection
│   │   ├── config.ts               # Configuration & constants
│   │   └── types.ts                # TypeScript types
│   ├── components/
│   │   ├── CallButton.tsx          # Initiate call button
│   │   ├── IncomingCallToast.tsx   # Upper-right accept/decline invite
│   │   ├── ActiveCallPanel.tsx     # Bottom sidebar active-call controls
│   │   ├── CallNotification.tsx    # Desktop notification
│   │   └── VideoDisplay.tsx        # Video streams (Phase 2)
│   ├── hooks/
│   │   ├── useCallManager.ts       # React hook for call state
│   │   └── useMediaDevices.ts      # Device permissions/selection
│   └── contexts/
│       └── CallContext.tsx         # Global call state
├── shared/
│   └── electrobunRpc.ts            # Add call-related RPC types
└── bun/
    └── index.ts                    # Desktop notifications handler
```

---

## Phase 1: Foundation

### Step 1.1: Define TypeScript Types

Create `src/mainview/webrtc/types.ts`:

```typescript
// Call state
export type CallState = 
  | 'idle'           // No active call
  | 'initiating'     // Creating offer
  | 'ringing'        // Waiting for answer (caller)
  | 'incoming'       // Received offer (callee)
  | 'connecting'     // Exchanging ICE candidates
  | 'connected'      // Call established
  | 'disconnecting'  // Hanging up
  | 'failed';        // Connection failed

export type CallType = 'audio' | 'video';

export type CallDirection = 'outgoing' | 'incoming';

// Signaling message types
export type SignalingAction = 
  | 'offer' 
  | 'answer' 
  | 'ice-candidate' 
  | 'hangup'
  | 'decline';

export interface CallSession {
  sessionId: string;
  channelId: string;        // DM channel for signaling
  otherUserId: string;      // The other participant
  direction: CallDirection;
  callType: CallType;
  state: CallState;
  startedAt: number;
  connectedAt?: number;
}

export interface SignalingMessage {
  action: SignalingAction;
  sessionId: string;
  timestamp: number;
  senderId: string;  // ADDED: Validate sender identity
  
  // For 'offer' and 'answer'
  sdp?: string;
  callType?: CallType;
  
  // For 'ice-candidate' - CHANGED: Support batching
  candidate?: RTCIceCandidateInit;
  candidates?: RTCIceCandidateInit[];  // Batch multiple ICE candidates
  
  // For 'decline'
  reason?: 'busy' | 'declined' | 'timeout';
}

// Multi-tab coordination
export interface TabCoordinationMessage {
  type: 'call-accepted' | 'call-declined' | 'call-ended';
  sessionId: string;
  timestamp: number;
}

// Mattermost custom post for signaling
export interface CallPost {
  type: 'custom_webrtc_call';
  props: SignalingMessage;
  channel_id: string;
  message: string;  // Empty or human-readable like "📞 Call"
}

// Call quality metrics
export interface CallStats {
  duration: number;           // seconds
  bytesSent: number;
  bytesReceived: number;
  packetsLost: number;
  jitter: number;            // ms
  roundTripTime: number;     // ms
  audioLevel: number;        // 0-1
}

// Configuration
export interface CallConfig {
  iceServers: RTCIceServer[];
  answerTimeout: number;     // ms to wait for answer
  offerTimeout: number;      // ms offer is valid
  enableAudioProcessing: boolean;
  enableVideoCodec: string;  // 'VP8' | 'VP9' | 'H264'
}

// Events emitted by CallManager
export interface CallEvents {
  onStateChange: (state: CallState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onStatsUpdate: (stats: CallStats) => void;
  onError: (error: CallError) => void;
  onCallEnded: (reason: string) => void;
}

export interface CallError {
  code: 'permission-denied' | 'network-error' | 'peer-error' | 'timeout' | 'unknown';
  message: string;
  fatal: boolean;  // Should end the call?
}
```

### Step 1.2: Update Shared RPC Types

Add to `src/shared/electrobunRpc.ts`:

```typescript
// Add to existing file

export type CallNotificationPayload = {
  type: 'incoming-call' | 'call-ended' | 'call-missed';
  fromUserId: string;
  fromUsername: string;
  callType: 'audio' | 'video';
  sessionId: string;
};

export type CallPermissionRequest = {
  type: 'microphone' | 'camera';
};

export type CallPermissionResponse = {
  granted: boolean;
  error?: string;
};
```

### Step 1.3: Create Configuration

Create `src/mainview/webrtc/config.ts`:

```typescript
import type { CallConfig } from './types';

export const DEFAULT_CALL_CONFIG: CallConfig = {
  // Free Google STUN servers
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  
  // Timeouts
  answerTimeout: 45_000,      // 45 seconds to answer
  offerTimeout: 60_000,       // Offer valid for 60 seconds
  
  // Audio processing
  enableAudioProcessing: true,  // Echo cancellation, noise suppression
  
  // Video codec preference
  enableVideoCodec: 'VP8',
};

// Optional: Add TURN server configuration
export function addTurnServer(
  config: CallConfig,
  urls: string | string[],
  username?: string,
  credential?: string
): CallConfig {
  return {
    ...config,
    iceServers: [
      ...config.iceServers,
      {
        urls,
        username,
        credential,
      },
    ],
  };
}

// Media constraints
export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
  },
  video: false,
};

export const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
  },
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    facingMode: 'user',
  },
};
```

---

## Phase 2: WebRTC Core

### Step 2.1: Media Devices Manager

Create `src/mainview/webrtc/MediaDevices.ts`:

```typescript
export class MediaDevicesManager {
  private stream: MediaStream | null = null;

  /**
   * Request microphone/camera permissions and get media stream
   */
  async getUserMedia(
    constraints: MediaStreamConstraints
  ): Promise<MediaStream> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.stream;
    } catch (error) {
      throw this.handleMediaError(error);
    }
  }

  /**
   * Get list of available devices
   */
  async getDevices(): Promise<{
    microphones: MediaDeviceInfo[];
    cameras: MediaDeviceInfo[];
    speakers: MediaDeviceInfo[];
  }> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    return {
      microphones: devices.filter((d) => d.kind === 'audioinput'),
      cameras: devices.filter((d) => d.kind === 'videoinput'),
      speakers: devices.filter((d) => d.kind === 'audiooutput'),
    };
  }

  /**
   * Check if permissions are granted
   */
  async checkPermissions(): Promise<{
    microphone: PermissionState;
    camera: PermissionState;
  }> {
    try {
      const micPermission = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      const cameraPermission = await navigator.permissions.query({
        name: 'camera' as PermissionName,
      });

      return {
        microphone: micPermission.state,
        camera: cameraPermission.state,
      };
    } catch (error) {
      // Fallback for browsers that don't support permissions API
      return {
        microphone: 'prompt',
        camera: 'prompt',
      };
    }
  }

  /**
   * Switch to a different microphone
   * Returns the new track so PeerConnection can be updated
   */
  async switchMicrophone(
    deviceId: string,
    peerConnection?: RTCPeerConnection
  ): Promise<MediaStreamTrack> {
    if (!this.stream) throw new Error('No active stream');

    const audioTrack = this.stream.getAudioTracks()[0];
    const constraints = {
      audio: { deviceId: { exact: deviceId } },
      video: false,
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newAudioTrack = newStream.getAudioTracks()[0];

    // Update PeerConnection sender if provided
    if (peerConnection) {
      const sender = peerConnection
        .getSenders()
        .find((s) => s.track?.kind === 'audio');
      
      if (sender) {
        await sender.replaceTrack(newAudioTrack);
      }
    }

    // Replace track in existing stream
    this.stream.removeTrack(audioTrack);
    this.stream.addTrack(newAudioTrack);
    audioTrack.stop();

    return newAudioTrack;
  }

  /**
   * Switch to a different camera
   * Returns the new track so PeerConnection can be updated
   */
  async switchCamera(
    deviceId: string,
    peerConnection?: RTCPeerConnection
  ): Promise<MediaStreamTrack> {
    if (!this.stream) throw new Error('No active stream');

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No active video track');

    const constraints = {
      audio: false,
      video: { deviceId: { exact: deviceId } },
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newVideoTrack = newStream.getVideoTracks()[0];

    // Update PeerConnection sender if provided
    if (peerConnection) {
      const sender = peerConnection
        .getSenders()
        .find((s) => s.track?.kind === 'video');
      
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }
    }

    // Replace track in existing stream
    this.stream.removeTrack(videoTrack);
    this.stream.addTrack(newVideoTrack);
    videoTrack.stop();

    return newVideoTrack;
  }

  /**
   * Stop all tracks and release resources
   */
  cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  /**
   * Get current stream (for adding to peer connection)
   */
  getStream(): MediaStream | null {
    return this.stream;
  }

  private handleMediaError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        return new Error('Microphone permission denied. Please allow access in settings.');
      }
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        return new Error('No microphone found. Please connect a microphone.');
      }
      if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        return new Error('Microphone is in use by another application.');
      }
      if (error.name === 'OverconstrainedError') {
        return new Error('Could not satisfy media constraints.');
      }
    }
    return new Error('Failed to access media devices');
  }
}
```

### Step 2.2: Call Signaling Handler

Create `src/mainview/webrtc/CallSignaling.ts`:

```typescript
import type { SignalingMessage, CallPost } from './types';

/**
 * Handles sending/receiving signaling messages via Mattermost
 * 
 * IMPORTANT: ICE candidates are batched to reduce Mattermost API load
 */
export class CallSignaling {
  private iceCandidateBuffer: Map<string, RTCIceCandidateInit[]> = new Map();
  private batchTimeout: Map<string, number> = new Map();
  private readonly BATCH_DELAY_MS = 100; // Wait 100ms to collect ICE candidates

  constructor(
    private mattermostApi: MattermostApiClient,
    private currentUserId: string,
    private onMessage: (message: SignalingMessage, channelId: string) => void
  ) {}

  /**
   * Send a signaling message via Mattermost DM
   * ICE candidates are batched automatically
   */
  async send(
    message: SignalingMessage,
    channelId: string
  ): Promise<void> {
    // Add sender ID for validation
    message.senderId = this.currentUserId;

    // Batch ICE candidates to reduce API load
    if (message.action === 'ice-candidate' && message.candidate) {
      this.batchIceCandidate(message, channelId);
      return;
    }

    const post: Partial<CallPost> = {
      channel_id: channelId,
      message: this.getHumanReadableMessage(message),
      type: 'custom_webrtc_call',
      props: {
        ...message,
        from_webhook: 'true', // Suppress mobile push notifications
      },
    };

    try {
      await this.mattermostApi.createPost(post);
    } catch (error) {
      console.error('Failed to send signaling message:', error);
      throw new Error('Failed to send call signaling');
    }
  }

  /**
   * Batch ICE candidates to send in groups rather than individually
   */
  private batchIceCandidate(
    message: SignalingMessage,
    channelId: string
  ): void {
    const key = `${message.sessionId}-${channelId}`;
    
    // Add to buffer
    if (!this.iceCandidateBuffer.has(key)) {
      this.iceCandidateBuffer.set(key, []);
    }
    this.iceCandidateBuffer.get(key)!.push(message.candidate!);

    // Clear existing timeout
    const existingTimeout = this.batchTimeout.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout to flush batch
    const timeout = window.setTimeout(() => {
      this.flushIceCandidates(message.sessionId, channelId);
    }, this.BATCH_DELAY_MS);

    this.batchTimeout.set(key, timeout);
  }

  /**
   * Flush batched ICE candidates
   */
  private async flushIceCandidates(
    sessionId: string,
    channelId: string
  ): Promise<void> {
    const key = `${sessionId}-${channelId}`;
    const candidates = this.iceCandidateBuffer.get(key);
    
    if (!candidates || candidates.length === 0) {
      return;
    }

    const message: SignalingMessage = {
      action: 'ice-candidate',
      sessionId,
      timestamp: Date.now(),
      senderId: this.currentUserId,
      candidates, // Send as batch
    };

    const post: Partial<CallPost> = {
      channel_id: channelId,
      message: this.getHumanReadableMessage(message),
      type: 'custom_webrtc_call',
      props: message,
    };

    try {
      await this.mattermostApi.createPost(post);
    } catch (error) {
      console.error('Failed to send batched ICE candidates:', error);
    }

    // Clear buffer
    this.iceCandidateBuffer.delete(key);
    this.batchTimeout.delete(key);
  }

  /**
   * Handle incoming post - check if it's a signaling message
   * SECURITY: Validates sender identity
   */
  handlePost(post: any, expectedUserId?: string): boolean {
    // Check if this is a call signaling message
    if (post.type !== 'custom_webrtc_call') {
      return false;
    }

    const message = post.props as SignalingMessage;
    
    // SECURITY: Validate sender matches expected user
    if (expectedUserId && message.senderId !== expectedUserId) {
      console.warn('Ignoring message from unexpected user:', message.senderId);
      return false;
    }

    // Validate message structure
    if (!this.isValidSignalingMessage(message)) {
      console.warn('Invalid signaling message:', message);
      return false;
    }

    // Check if offer/answer is expired
    if (message.action === 'offer' || message.action === 'answer') {
      const age = Date.now() - message.timestamp;
      if (age > 60_000) {  // 60 seconds
        console.log('Ignoring expired signaling message');
        return false;
      }
    }

    // Pass to handler
    this.onMessage(message, post.channel_id);
    return true;
  }

  /**
   * Cleanup batched candidates for a session
   */
  cleanup(sessionId: string): void {
    // Clear any pending batches
    for (const [key, timeout] of this.batchTimeout.entries()) {
      if (key.startsWith(sessionId)) {
        clearTimeout(timeout);
        this.batchTimeout.delete(key);
        this.iceCandidateBuffer.delete(key);
      }
    }
  }

  /**
   * Get the direct message channel ID for a user (or create it)
   */
  async getDmChannelId(userId: string, myUserId: string): Promise<string> {
    try {
      // Mattermost API to get or create DM channel
      const channel = await this.mattermostApi.createDirectChannel([myUserId, userId]);
      return channel.id;
    } catch (error) {
      console.error('Failed to get DM channel:', error);
      throw new Error('Failed to create direct message channel');
    }
  }

  private isValidSignalingMessage(message: any): message is SignalingMessage {
    if (!message || typeof message !== 'object') return false;
    if (typeof message.sessionId !== 'string') return false;
    if (typeof message.action !== 'string') return false;
    if (typeof message.timestamp !== 'number') return false;
    if (typeof message.senderId !== 'string') return false; // ADDED

    // Validate action-specific fields
    switch (message.action) {
      case 'offer':
      case 'answer':
        return typeof message.sdp === 'string' && !!message.callType;
      case 'ice-candidate':
        // Support both single candidate and batched candidates
        return !!message.candidate || (Array.isArray(message.candidates) && message.candidates.length > 0);
      case 'hangup':
      case 'decline':
        return true;
      default:
        return false;
    }
  }

  private getHumanReadableMessage(message: SignalingMessage): string {
    // These messages WILL be visible to regular Mattermost users
    // Keep them brief and user-friendly
    switch (message.action) {
      case 'offer':
        return `📞 ${message.callType === 'video' ? 'Video' : 'Voice'} call`;
      case 'answer':
        return '📞 Call answered';
      case 'ice-candidate':
        return '📞 Call connecting...';
      case 'hangup':
        return '📞 Call ended';
      case 'decline':
        return '📞 Call declined';
      default:
        return '📞 Call signaling';
    }
  }

  /**
   * OPTIONAL: Send signaling via WebSocket custom event instead of post
   * Requires Mattermost server plugin to relay custom events
   */
  async sendViaWebSocket(
    message: SignalingMessage,
    recipientUserId: string,
    websocket: WebSocket
  ): Promise<void> {
    const event = {
      action: 'custom_event',
      seq: Date.now(),
      data: {
        event: 'webrtc_signal',
        data: message,
        broadcast: {
          user_id: recipientUserId,
        },
      },
    };

    websocket.send(JSON.stringify(event));
  }

  /**
   * Handle incoming WebSocket custom event (alternative to posts)
   */
  handleWebSocketEvent(event: any): boolean {
    if (event.event !== 'webrtc_signal') {
      return false;
    }

    const message = event.data as SignalingMessage;
    
    if (!this.isValidSignalingMessage(message)) {
      console.warn('Invalid signaling message from WebSocket:', message);
      return false;
    }

    // Get or create channel ID for the session
    // Note: We still need to know which channel this relates to
    const channelId = event.channel_id || 'direct-message';
    
    this.onMessage(message, channelId);
    return true;
  }
}
```

### Step 2.3: Core Call Manager

Create `src/mainview/webrtc/CallManager.ts`:

```typescript
import type {
  CallSession,
  CallState,
  CallType,
  SignalingMessage,
  CallStats,
  CallEvents,
  CallConfig,
  CallError,
} from './types';
import { MediaDevicesManager } from './MediaDevices';
import { CallSignaling } from './CallSignaling';
import { DEFAULT_CALL_CONFIG, AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS } from './config';

export class CallManager {
  private peerConnection: RTCPeerConnection | null = null;
  private mediaManager: MediaDevicesManager;
  private signaling: CallSignaling;
  private config: CallConfig;
  
  private currentSession: CallSession | null = null;
  private state: CallState = 'idle';
  private statsInterval: number | null = null;
  private answerTimeout: number | null = null;
  
  // NEW: ICE candidate buffering for race condition prevention
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  
  // NEW: Remote stream assembly
  private remoteStream: MediaStream | null = null;
  
  // NEW: Multi-tab coordination
  private tabChannel: BroadcastChannel;
  
  // Event callbacks
  private events: Partial<CallEvents> = {};

  constructor(
    mattermostApi: any,
    private currentUserId: string,
    config: Partial<CallConfig> = {}
  ) {
    this.config = { ...DEFAULT_CALL_CONFIG, ...config };
    this.mediaManager = new MediaDevicesManager();
    this.signaling = new CallSignaling(
      mattermostApi,
      currentUserId,
      this.handleSignalingMessage.bind(this)
    );
    
    // Multi-tab coordination
    this.tabChannel = new BroadcastChannel('antimatter-calls');
    this.tabChannel.onmessage = this.handleTabMessage.bind(this);
    
    // Check for orphaned sessions on startup
    this.checkForOrphanedSession();
  }

  /**
   * Register event callbacks
   */
  on<K extends keyof CallEvents>(event: K, callback: CallEvents[K]): void {
    this.events[event] = callback;
  }

  /**
   * Initiate a call to another user
   */
  async initiateCall(
    userId: string,
    myUserId: string,
    callType: CallType
  ): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('Call already in progress');
    }

    this.setState('initiating');

    try {
      // Get DM channel for signaling
      const channelId = await this.signaling.getDmChannelId(userId, myUserId);

      // Create session
      const sessionId = crypto.randomUUID();
      this.currentSession = {
        sessionId,
        channelId,
        otherUserId: userId,
        direction: 'outgoing',
        callType,
        state: 'initiating',
        startedAt: Date.now(),
      };

      // Get local media
      const constraints = callType === 'video'
        ? VIDEO_CONSTRAINTS
        : AUDIO_CONSTRAINTS;
      await this.mediaManager.getUserMedia(constraints);

      // Create peer connection
      await this.createPeerConnection();

      // Add local tracks
      const stream = this.mediaManager.getStream();
      if (stream) {
        stream.getTracks().forEach((track) => {
          this.peerConnection!.addTrack(track, stream);
        });
      }

      // Create and send offer
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });
      
      await this.peerConnection!.setLocalDescription(offer);

      const message: SignalingMessage = {
        action: 'offer',
        sessionId,
        timestamp: Date.now(),
        sdp: offer.sdp!,
        callType,
      };

      await this.signaling.send(message, channelId);

      this.setState('ringing');
      
      // Set timeout for answer
      this.answerTimeout = window.setTimeout(() => {
        this.handleTimeout('No answer');
      }, this.config.answerTimeout);

    } catch (error) {
      this.handleError({
        code: error instanceof Error && error.message.includes('permission') 
          ? 'permission-denied' 
          : 'unknown',
        message: error instanceof Error ? error.message : 'Failed to initiate call',
        fatal: true,
      });
    }
  }

  /**
   * Accept an incoming call
   */
  async acceptCall(): Promise<void> {
    if (this.state !== 'incoming' || !this.currentSession) {
      throw new Error('No incoming call to accept');
    }

    // Notify other tabs that we're accepting
    this.tabChannel.postMessage({
      type: 'call-accepted',
      sessionId: this.currentSession.sessionId,
      timestamp: Date.now(),
    });

    this.setState('connecting');

    try {
      // Get local media
      const constraints = this.currentSession.callType === 'video'
        ? VIDEO_CONSTRAINTS
        : AUDIO_CONSTRAINTS;
      await this.mediaManager.getUserMedia(constraints);

      // Peer connection was already created in handleOffer
      // Add local tracks
      const stream = this.mediaManager.getStream();
      if (stream) {
        stream.getTracks().forEach((track) => {
          this.peerConnection!.addTrack(track, stream);
        });
      }

      // Create and send answer
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      const message: SignalingMessage = {
        action: 'answer',
        sessionId: this.currentSession.sessionId,
        timestamp: Date.now(),
        sdp: answer.sdp!,
      };

      await this.signaling.send(message, this.currentSession.channelId);

    } catch (error) {
      this.handleError({
        code: 'unknown',
        message: error instanceof Error ? error.message : 'Failed to accept call',
        fatal: true,
      });
    }
  }

  /**
   * Decline an incoming call
   */
  async declineCall(reason: 'busy' | 'declined' = 'declined'): Promise<void> {
    if (this.state !== 'incoming' || !this.currentSession) {
      throw new Error('No incoming call to decline');
    }

    const message: SignalingMessage = {
      action: 'decline',
      sessionId: this.currentSession.sessionId,
      timestamp: Date.now(),
      reason,
    };

    await this.signaling.send(message, this.currentSession.channelId);
    this.cleanup('Call declined');
  }

  /**
   * Hang up the current call
   */
  async hangup(): Promise<void> {
    if (this.state === 'idle') {
      return;
    }

    if (this.currentSession) {
      const message: SignalingMessage = {
        action: 'hangup',
        sessionId: this.currentSession.sessionId,
        timestamp: Date.now(),
      };

      await this.signaling.send(message, this.currentSession.channelId);
    }

    this.cleanup('Call ended');
  }

  /**
   * Mute/unmute local audio
   */
  setAudioMuted(muted: boolean): void {
    const stream = this.mediaManager.getStream();
    if (!stream) return;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  /**
   * Enable/disable local video
   */
  setVideoEnabled(enabled: boolean): void {
    const stream = this.mediaManager.getStream();
    if (!stream) return;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  /**
   * Get current call session
   */
  getSession(): CallSession | null {
    return this.currentSession;
  }

  /**
   * Get current call state
   */
  getState(): CallState {
    return this.state;
  }

  /**
   * Get local media stream
   */
  getLocalStream(): MediaStream | null {
    return this.mediaManager.getStream();
  }

  /**
   * Handle incoming signaling message
   */
  handleIncomingPost(post: any): void {
    // Pass expected user ID for validation
    const expectedUserId = this.currentSession?.otherUserId;
    this.signaling.handlePost(post, expectedUserId);
  }

  /**
   * Switch microphone device during active call
   */
  async switchMicrophone(deviceId: string): Promise<void> {
    await this.mediaManager.switchMicrophone(deviceId, this.peerConnection || undefined);
  }

  /**
   * Switch camera device during active call
   */
  async switchCamera(deviceId: string): Promise<void> {
    await this.mediaManager.switchCamera(deviceId, this.peerConnection || undefined);
  }

  /**
   * Create RTCPeerConnection with proper configuration
   */
  private async createPeerConnection(): Promise<void> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers,
    });

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.currentSession) {
        const message: SignalingMessage = {
          action: 'ice-candidate',
          sessionId: this.currentSession.sessionId,
          timestamp: Date.now(),
          candidate: event.candidate.toJSON(),
        };

        this.signaling.send(message, this.currentSession.channelId)
          .catch((err) => console.error('Failed to send ICE candidate:', err));
      }
    };

    // Handle remote tracks - assemble complete stream
    this.peerConnection.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      
      // Create remote stream if it doesn't exist
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      
      // Add track to remote stream
      this.remoteStream.addTrack(event.track);
      
      // Check if we have all expected tracks
      const hasAudio = this.remoteStream.getAudioTracks().length > 0;
      const hasVideo = this.currentSession?.callType === 'video'
        ? this.remoteStream.getVideoTracks().length > 0
        : true;
      
      // Notify when stream is complete
      if (hasAudio && hasVideo && this.events.onRemoteStream) {
        this.events.onRemoteStream(this.remoteStream);
      }
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection!.connectionState;
      console.log('Connection state:', state);

      switch (state) {
        case 'connected':
          this.handleConnectionEstablished();
          break;
        case 'disconnected':
        case 'failed':
          this.handleError({
            code: 'peer-error',
            message: 'Connection lost',
            fatal: true,
          });
          break;
        case 'closed':
          this.cleanup('Connection closed');
          break;
      }
    };

    // Handle ICE connection state with restart capability
    this.peerConnection.oniceconnectionstatechange = async () => {
      const state = this.peerConnection!.iceConnectionState;
      console.log('ICE connection state:', state);

      switch (state) {
        case 'disconnected':
          // Attempt ICE restart on network change
          console.log('Connection disconnected, attempting ICE restart...');
          setTimeout(() => {
            if (this.peerConnection?.iceConnectionState === 'disconnected') {
              this.restartIce();
            }
          }, 3000); // Wait 3s before restart
          break;
        case 'failed':
          this.handleError({
            code: 'network-error',
            message: 'Failed to establish connection. This may be due to firewall or network restrictions.',
            fatal: true,
          });
          break;
      }
    };
  }

  /**
   * Handle incoming signaling message
   */
  private async handleSignalingMessage(
    message: SignalingMessage,
    channelId: string
  ): Promise<void> {
    console.log('Received signaling message:', message.action);

    switch (message.action) {
      case 'offer':
        await this.handleOffer(message, channelId);
        break;
      case 'answer':
        await this.handleAnswer(message);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(message);
        break;
      case 'hangup':
        this.cleanup('Remote user ended the call');
        break;
      case 'decline':
        this.cleanup(`Call ${message.reason === 'busy' ? 'rejected (busy)' : 'declined'}`);
        break;
    }
  }

  /**
   * Handle incoming call offer
   */
  private async handleOffer(
    message: SignalingMessage,
    channelId: string
  ): Promise<void> {
    if (this.state !== 'idle') {
      // We're busy - send decline
      const response: SignalingMessage = {
        action: 'decline',
        sessionId: message.sessionId,
        timestamp: Date.now(),
        reason: 'busy',
      };
      await this.signaling.send(response, channelId);
      return;
    }

    try {
      // Create session for incoming call
      this.currentSession = {
        sessionId: message.sessionId,
        channelId,
        otherUserId: '', // Will be filled from post metadata
        direction: 'incoming',
        callType: message.callType!,
        state: 'incoming',
        startedAt: Date.now(),
      };

      // Create peer connection (but don't get media yet - wait for accept)
      await this.createPeerConnection();

      // Set remote description
      await this.peerConnection!.setRemoteDescription({
        type: 'offer',
        sdp: message.sdp!,
      });

      // CRITICAL: Flush buffered ICE candidates
      await this.flushPendingIceCandidates();

      this.setState('incoming');

    } catch (error) {
      console.error('Failed to handle offer:', error);
      this.cleanup('Failed to process incoming call');
    }
  }

  /**
   * Handle incoming answer
   */
  private async handleAnswer(message: SignalingMessage): Promise<void> {
    if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
      return;
    }

    if (this.state !== 'ringing') {
      console.warn('Received answer in wrong state:', this.state);
      return;
    }

    try {
      await this.peerConnection!.setRemoteDescription({
        type: 'answer',
        sdp: message.sdp!,
      });

      // CRITICAL: Flush buffered ICE candidates
      await this.flushPendingIceCandidates();

      // Clear answer timeout
      if (this.answerTimeout) {
        clearTimeout(this.answerTimeout);
        this.answerTimeout = null;
      }

      this.setState('connecting');

    } catch (error) {
      this.handleError({
        code: 'peer-error',
        message: 'Failed to process answer',
        fatal: true,
      });
    }
  }

  /**
   * Handle incoming ICE candidate(s) - with buffering for race conditions
   */
  private async handleIceCandidate(message: SignalingMessage): Promise<void> {
    if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
      return;
    }

    if (!this.peerConnection) {
      return;
    }

    // Collect all candidates (single or batch)
    const candidates = message.candidates || (message.candidate ? [message.candidate] : []);

    // If remote description isn't set yet, buffer candidates
    if (!this.peerConnection.remoteDescription) {
      console.log('Buffering ICE candidates until remote description is set');
      this.pendingIceCandidates.push(...candidates);
      return;
    }

    // Add candidates immediately
    for (const candidate of candidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Failed to add ICE candidate:', error);
        // Don't treat as fatal - some candidates may fail
      }
    }
  }

  /**
   * Flush buffered ICE candidates after setRemoteDescription
   */
  private async flushPendingIceCandidates(): Promise<void> {
    if (this.pendingIceCandidates.length === 0) {
      return;
    }

    console.log(`Flushing ${this.pendingIceCandidates.length} buffered ICE candidates`);

    for (const candidate of this.pendingIceCandidates) {
      try {
        await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Failed to add buffered ICE candidate:', error);
      }
    }

    this.pendingIceCandidates = [];
  }

  /**
   * Handle successful connection establishment
   */
  private handleConnectionEstablished(): void {
    if (this.currentSession) {
      this.currentSession.connectedAt = Date.now();
    }

    this.setState('connected');

    // Start collecting stats
    this.startStatsCollection();
  }

  /**
   * Start collecting call quality stats
   */
  private startStatsCollection(): void {
    this.statsInterval = window.setInterval(async () => {
      if (!this.peerConnection || this.state !== 'connected') {
        return;
      }

      const stats = await this.peerConnection.getStats();
      const callStats = this.parseStats(stats);
      
      if (callStats && this.events.onStatsUpdate) {
        this.events.onStatsUpdate(callStats);
      }
    }, 1000);
  }

  /**
   * Parse RTCStatsReport into our CallStats format
   */
  private parseStats(stats: RTCStatsReport): CallStats | null {
    let bytesSent = 0;
    let bytesReceived = 0;
    let packetsLost = 0;
    let jitter = 0;
    let roundTripTime = 0;
    let audioLevel = 0;

    stats.forEach((report) => {
      if (report.type === 'outbound-rtp') {
        bytesSent += report.bytesSent || 0;
      }
      if (report.type === 'inbound-rtp') {
        bytesReceived += report.bytesReceived || 0;
        packetsLost += report.packetsLost || 0;
        jitter = report.jitter || 0;
      }
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        roundTripTime = report.currentRoundTripTime || 0;
      }
      if (report.type === 'media-source' && report.kind === 'audio') {
        audioLevel = report.audioLevel || 0;
      }
    });

    const duration = this.currentSession?.connectedAt
      ? Math.floor((Date.now() - this.currentSession.connectedAt) / 1000)
      : 0;

    return {
      duration,
      bytesSent,
      bytesReceived,
      packetsLost,
      jitter: jitter * 1000, // Convert to ms
      roundTripTime: roundTripTime * 1000, // Convert to ms
      audioLevel,
    };
  }

  /**
   * Handle timeout (no answer received)
   */
  private handleTimeout(reason: string): void {
    this.handleError({
      code: 'timeout',
      message: reason,
      fatal: true,
    });
  }

  /**
   * Handle errors
   */
  private handleError(error: CallError): void {
    console.error('Call error:', error);

    if (this.events.onError) {
      this.events.onError(error);
    }

    if (error.fatal) {
      this.cleanup(error.message);
    }
  }

  /**
   * Update and emit state changes
   */
  private setState(newState: CallState): void {
    if (this.state === newState) return;

    this.state = newState;
    
    if (this.currentSession) {
      this.currentSession.state = newState;
    }

    if (this.events.onStateChange) {
      this.events.onStateChange(newState);
    }
  }

  /**
   * Restart ICE on network change
   */
  private async restartIce(): Promise<void> {
    if (!this.peerConnection || !this.currentSession) {
      return;
    }

    console.log('Attempting ICE restart...');

    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);

      const message: SignalingMessage = {
        action: 'offer',
        sessionId: this.currentSession.sessionId,
        timestamp: Date.now(),
        senderId: this.currentUserId,
        sdp: offer.sdp!,
        callType: this.currentSession.callType,
      };

      await this.signaling.send(message, this.currentSession.channelId);
    } catch (error) {
      console.error('ICE restart failed:', error);
      this.handleError({
        code: 'network-error',
        message: 'Failed to restart connection',
        fatal: true,
      });
    }
  }

  /**
   * Handle messages from other tabs
   */
  private handleTabMessage(event: MessageEvent<TabCoordinationMessage>): void {
    const message = event.data;

    if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
      return;
    }

    switch (message.type) {
      case 'call-accepted':
        // Another tab accepted, close this one
        this.cleanup('Call accepted in another tab');
        break;
      case 'call-declined':
        this.cleanup('Call declined in another tab');
        break;
      case 'call-ended':
        this.cleanup('Call ended in another tab');
        break;
    }
  }

  /**
   * Check for orphaned session after page refresh
   */
  private checkForOrphanedSession(): void {
    const savedSession = localStorage.getItem('antimatter-active-call');
    
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession) as CallSession;
        
        // Check if session is recent (within 5 minutes)
        const age = Date.now() - session.startedAt;
        if (age < 5 * 60 * 1000) {
          // Prompt user to reconnect
          if (this.events.onError) {
            this.events.onError({
              code: 'unknown',
              message: `You have an active call with ${session.otherUserId}. Reconnect?`,
              fatal: false,
            });
          }
        }
      } catch (error) {
        console.error('Failed to parse saved session:', error);
      }
      
      // Clear regardless
      localStorage.removeItem('antimatter-active-call');
    }
  }

  /**
   * Save session to localStorage for recovery after refresh
   */
  private saveSessionToStorage(): void {
    if (this.currentSession && this.state === 'connected') {
      localStorage.setItem('antimatter-active-call', JSON.stringify(this.currentSession));
    }
  }

  /**
   * Clean up resources and end call
   */
  private cleanup(reason: string): void {
    console.log('Cleaning up call:', reason);

    // Clear timeouts
    if (this.answerTimeout) {
      clearTimeout(this.answerTimeout);
      this.answerTimeout = null;
    }

    // Stop stats collection
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Close peer connection and remove event listeners
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Release media devices
    this.mediaManager.cleanup();

    // Clear ICE candidate buffer
    this.pendingIceCandidates = [];
    
    // Clear remote stream
    this.remoteStream = null;

    // Clear signaling batches
    if (this.currentSession) {
      this.signaling.cleanup(this.currentSession.sessionId);
      
      // Notify other tabs
      this.tabChannel.postMessage({
        type: 'call-ended',
        sessionId: this.currentSession.sessionId,
        timestamp: Date.now(),
      });
    }

    // Clear session from storage
    localStorage.removeItem('antimatter-active-call');

    // Clear session
    this.currentSession = null;

    // Update state
    this.setState('idle');

    // Notify
    if (this.events.onCallEnded) {
      this.events.onCallEnded(reason);
    }
  }

  /**
   * Cleanup on destruction
   */
  destroy(): void {
    this.cleanup('Manager destroyed');
    this.tabChannel.close();
  }
}

// Export singleton or factory
export function createCallManager(
  mattermostApi: any,
  currentUserId: string,
  config?: Partial<CallConfig>
): CallManager {
  return new CallManager(mattermostApi, currentUserId, config);
}
```

---

## Phase 3: UI Components

### Step 3.1: Call Context Provider

Create `src/mainview/contexts/CallContext.tsx`:

```typescript
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { CallManager } from '../webrtc/CallManager';
import type { CallState, CallSession, CallError, CallStats } from '../webrtc/types';

interface CallContextValue {
  callManager: CallManager;
  state: CallState;
  session: CallSession | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  stats: CallStats | null;
  error: CallError | null;
  
  // Actions
  initiateCall: (userId: string, username: string, callType: 'audio' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: (reason?: 'busy' | 'declined') => Promise<void>;
  hangup: () => Promise<void>;
  setAudioMuted: (muted: boolean) => void;
  setVideoEnabled: (enabled: boolean) => void;
  switchMicrophone: (deviceId: string) => Promise<void>;
  switchCamera: (deviceId: string) => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({
  children,
  callManager,
  currentUserId,
}: {
  children: React.ReactNode;
  callManager: CallManager;
  currentUserId: string;
}) {
  const [state, setState] = useState<CallState>('idle');
  const [session, setSession] = useState<CallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [error, setError] = useState<CallError | null>(null);

  // Register event callbacks
  useEffect(() => {
    callManager.on('onStateChange', (newState) => {
      setState(newState);
      setSession(callManager.getSession());
      
      // Update local stream when state changes
      if (newState === 'connected' || newState === 'ringing') {
        setLocalStream(callManager.getLocalStream());
      }
    });

    callManager.on('onRemoteStream', (stream) => {
      setRemoteStream(stream);
    });

    callManager.on('onStatsUpdate', (newStats) => {
      setStats(newStats);
    });

    callManager.on('onError', (err) => {
      setError(err);
    });

    callManager.on('onCallEnded', (reason) => {
      console.log('Call ended:', reason);
      setLocalStream(null);
      setRemoteStream(null);
      setStats(null);
      setError(null);
    });
  }, [callManager]);

  const initiateCall = useCallback(
    async (userId: string, username: string, callType: 'audio' | 'video') => {
      try {
        await callManager.initiateCall(userId, currentUserId, callType);
      } catch (err) {
        console.error('Failed to initiate call:', err);
      }
    },
    [callManager, currentUserId]
  );

  const acceptCall = useCallback(async () => {
    try {
      await callManager.acceptCall();
    } catch (err) {
      console.error('Failed to accept call:', err);
    }
  }, [callManager]);

  const declineCall = useCallback(
    async (reason: 'busy' | 'declined' = 'declined') => {
      try {
        await callManager.declineCall(reason);
      } catch (err) {
        console.error('Failed to decline call:', err);
      }
    },
    [callManager]
  );

  const hangup = useCallback(async () => {
    try {
      await callManager.hangup();
    } catch (err) {
      console.error('Failed to hang up:', err);
    }
  }, [callManager]);

  const setAudioMuted = useCallback(
    (muted: boolean) => {
      callManager.setAudioMuted(muted);
    },
    [callManager]
  );

  const setVideoEnabled = useCallback(
    (enabled: boolean) => {
      callManager.setVideoEnabled(enabled);
    },
    [callManager]
  );

  const switchMicrophone = useCallback(
    async (deviceId: string) => {
      await callManager.switchMicrophone(deviceId);
    },
    [callManager]
  );

  const switchCamera = useCallback(
    async (deviceId: string) => {
      await callManager.switchCamera(deviceId);
    },
    [callManager]
  );

  return (
    <CallContext.Provider
      value={{
        callManager,
        state,
        session,
        localStream,
        remoteStream,
        stats,
        error,
        initiateCall,
        acceptCall,
        declineCall,
        hangup,
        setAudioMuted,
        setVideoEnabled,
        switchMicrophone,
        switchCamera,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within CallProvider');
  }
  return context;
}
```

### Step 3.2: Call Button

Create `src/mainview/components/CallButton.tsx`:

```typescript
import React from 'react';
import { useCall } from '../contexts/CallContext';

interface CallButtonProps {
  userId: string;
  username: string;
  variant: 'audio' | 'video';
  disabled?: boolean;
}

export function CallButton({ userId, username, variant, disabled }: CallButtonProps) {
  const { state, initiateCall } = useCall();

  const isDisabled = disabled || state !== 'idle';

  const handleClick = async () => {
    await initiateCall(userId, username, variant);
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className="call-button"
      title={`Start ${variant} call with ${username}`}
    >
      {variant === 'audio' ? '📞' : '📹'}
    </button>
  );
}
```

### Step 3.3: Incoming Call Toast

Create `src/mainview/components/IncomingCallToast.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { useCall } from '../contexts/CallContext';

interface IncomingCallToastProps {
  callerName: string;
  callerAvatar?: string;
}

export function IncomingCallToast({ callerName, callerAvatar }: IncomingCallToastProps) {
  const { state, session, acceptCall, declineCall } = useCall();
  const [countdown, setCountdown] = useState(45);

  // Show only for incoming calls
  if (state !== 'incoming' || !session) {
    return null;
  }

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="incoming-call-toast">
      <div className="toast-header">
        <span className="call-icon">📞</span>
        <span className="call-type">
          {session.callType === 'video' ? 'Video' : 'Voice'} Call
        </span>
        <span className="countdown">{countdown}s</span>
      </div>

      <div className="toast-body">
        {callerAvatar && (
          <img src={callerAvatar} alt={callerName} className="caller-avatar" />
        )}
        <div className="caller-info">
          <div className="caller-name">{callerName}</div>
          <div className="caller-status">is calling...</div>
        </div>
      </div>

      <div className="toast-actions">
        <button onClick={() => declineCall('declined')} className="btn-decline">
          Decline
        </button>
        <button onClick={acceptCall} className="btn-accept">
          Accept
        </button>
      </div>
    </div>
  );
}
```

### Step 3.4: Active Call Panel

Create `src/mainview/components/ActiveCallPanel.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { useCall } from '../contexts/CallContext';

interface ActiveCallPanelProps {
  callerName: string;
}

export function ActiveCallPanel({ callerName }: ActiveCallPanelProps) {
  const { state, session, stats, hangup, setAudioMuted, setVideoEnabled } = useCall();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState('00:00');

  // Show only when connected
  if (state !== 'connected' || !session) {
    return null;
  }

  // Update duration
  useEffect(() => {
    const interval = setInterval(() => {
      if (stats) {
        const minutes = Math.floor(stats.duration / 60);
        const seconds = stats.duration % 60;
        setDuration(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [stats]);

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    setAudioMuted(newMuted);
  };

  const toggleVideo = () => {
    const newVideoOff = !isVideoOff;
    setIsVideoOff(newVideoOff);
    setVideoEnabled(!newVideoOff);
  };

  return (
    <div className="active-call-panel">
      <div className="call-header">
        <div className="call-indicator">
          <span className="indicator-dot"></span>
          <span className="call-with">Call with {callerName}</span>
        </div>
        <div className="call-duration">{duration}</div>
      </div>

      <div className="call-controls">
        <button
          onClick={toggleMute}
          className={`control-btn ${isMuted ? 'active' : ''}`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>

        {session.callType === 'video' && (
          <button
            onClick={toggleVideo}
            className={`control-btn ${isVideoOff ? 'active' : ''}`}
            title={isVideoOff ? 'Enable video' : 'Disable video'}
          >
            {isVideoOff ? '📹' : '📷'}
          </button>
        )}

        <button onClick={hangup} className="control-btn btn-hangup" title="Hang up">
          ❌
        </button>
      </div>

      {stats && (
        <div className="call-stats">
          <div className="stat">
            <span className="stat-label">Latency:</span>
            <span className="stat-value">{Math.round(stats.roundTripTime)}ms</span>
          </div>
          <div className="stat">
            <span className="stat-label">Packet Loss:</span>
            <span className="stat-value">{stats.packetsLost}</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

### UI Behavior Notes

- Keep the call button in the existing DM/user surfaces. The call button design is acceptable as-is.
- Do not use a blocking modal for incoming calls. Incoming call UI should behave like a persistent toast notification in the upper-right corner of the app.
- The incoming call toast stays visible until the user answers, declines, the caller hangs up, or the answer timeout expires.
- The incoming toast should include caller identity, call type, compact answer/decline buttons, and a subtle countdown or timeout affordance when useful.
- Once a call connects, dismiss the incoming/outgoing toast state and show the active call as a docked panel at the bottom of the left sidebar, similar to Discord's active voice panel.
- The sidebar call panel should remain visible while navigating channels and should include the other participant, connection state/duration, mute, device/settings if available, and hangup controls.
- The active call panel should reserve space at the bottom of the sidebar rather than overlaying the channel list. The channel list should scroll above it.

### Step 3.5: Basic Styling (CSS)

Add to your main CSS file:

```css
/* Incoming Call Toast - Upper Right */
.incoming-call-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 320px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(400px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.toast-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
}

.call-icon {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
}

.countdown {
  margin-left: auto;
  color: #666;
  font-size: 12px;
}

.toast-body {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.caller-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
}

.caller-name {
  font-weight: 600;
  font-size: 16px;
}

.caller-status {
  font-size: 14px;
  color: #666;
}

.toast-actions {
  display: flex;
  gap: 8px;
}

.btn-decline,
.btn-accept {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-decline {
  background: #f0f0f0;
  color: #333;
}

.btn-decline:hover {
  opacity: 0.8;
}

.btn-accept {
  background: #28a745;
  color: white;
}

.btn-accept:hover {
  opacity: 0.9;
}

/* Active Call Panel - Bottom of Sidebar */
.active-call-panel {
  position: sticky;
  bottom: 0;
  background: #2c2f33;
  color: white;
  padding: 12px;
  border-top: 1px solid #202225;
}

.call-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.call-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.indicator-dot {
  width: 8px;
  height: 8px;
  background: #28a745;
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

.call-duration {
  font-size: 12px;
  color: #b9bbbe;
}

.call-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.control-btn {
  flex: 1;
  padding: 8px;
  background: #40444b;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.control-btn:hover {
  background: #4f545c;
}

.control-btn.active {
  background: #ed4245;
}

.btn-hangup {
  background: #ed4245;
}

.btn-hangup:hover {
  background: #c03537;
}

.call-stats {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: #b9bbbe;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  opacity: 0.7;
}

.stat-value {
  font-weight: 600;
}

/* Call Button */
.call-button {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.call-button:hover:not(:disabled) {
  opacity: 1;
}

.call-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
```

---

## Phase 4: Integration

### Step 4.1: Initialize CallManager

In your main app initialization (e.g., `src/mainview/index.tsx`):

```typescript
import { createCallManager } from './webrtc/CallManager';
import { CallProvider } from './contexts/CallContext';

// Create call manager instance
const callManager = createCallManager(mattermostApi, currentUser.id);

// Wrap app with CallProvider
<CallProvider callManager={callManager} currentUserId={currentUser.id}>
  <App />
</CallProvider>
```

### Step 4.2: Hook into WebSocket

In `src/mainview/mattermostWebSocket.ts`, add call signaling handling:

```typescript
private handleMessage(event: MessageEvent) {
  const data = JSON.parse(event.data);
  
  if (data.event === 'posted') {
    const post = JSON.parse(data.data.post);
    
    // Check if it's a call signaling message
    if (post.type === 'custom_webrtc_call') {
      // Pass to call manager
      callManager.handleIncomingPost(post);
      
      // CRITICAL: Return early to hide from UI
      // This prevents signaling messages from appearing in Antimatter's timeline
      return;
    }
    
    // Regular message handling...
  }
}
```

### Step 4.2b: Filter Signaling Messages from Timeline

In your message timeline component, add an additional filter:

```typescript
// In MessageTimeline.tsx or wherever messages are rendered
function MessageTimeline({ messages }: { messages: Post[] }) {
  // Filter out call signaling messages
  const visibleMessages = messages.filter((post) => {
    // Hide WebRTC signaling posts
    if (post.type === 'custom_webrtc_call') {
      return false;
    }
    return true;
  });

  return (
    <div className="timeline">
      {visibleMessages.map((message) => (
        <Message key={message.id} post={message} />
      ))}
    </div>
  );
}
```

This ensures:
- ✅ Antimatter users never see signaling messages in their UI
- ✅ Messages are still processed by CallManager
- ✅ Clean chat experience for Antimatter users
- ❌ Regular Mattermost users still see them (can't be fixed without server plugin)

### Step 4.3: Add Call Buttons to UI

In user profile, DM headers, etc.:

```tsx
import { CallButton } from './components/CallButton';

// In your component
<CallButton 
  userId={user.id} 
  username={user.username}
  variant="audio"
/>
<CallButton 
  userId={user.id} 
  username={user.username}
  variant="video"
/>
```

### Step 4.4: Add Call Surfaces

In your root component:

```tsx
import { IncomingCallToast } from './components/IncomingCallToast';
import { ActiveCallPanel } from './components/ActiveCallPanel';
import { useCall } from './contexts/CallContext';

function App() {
  const { state, session } = useCall();
  
  return (
    <>
      {/* Your existing app */}
      
      {/* Upper-right pending-call invite */}
      <IncomingCallToast
        callerName={getCallerName(session?.otherUserId)}
        callerAvatar={getCallerAvatar(session?.otherUserId)}
      />
    </>
  );
}
```

Render `ActiveCallPanel` from the sidebar, below the channel list:

```tsx
function Sidebar() {
  const { state, session } = useCall();

  return (
    <aside className="sidebar">
      <div className="channel-list-shell">
        {/* Existing team/channel navigation */}
      </div>

      {state === 'connected' && (
        <ActiveCallPanel
          callerName={getCallerName(session?.otherUserId)}
        />
      )}
    </aside>
  );
}
```

---

## Phase 5: Polish & Testing

### Step 5.1: Desktop Notifications

Add native notifications for incoming calls in `src/bun/index.ts`:

```typescript
// Handle call notifications via RPC
rpc.handle('showCallNotification', async (payload: CallNotificationPayload) => {
  const notification = new Notification({
    title: payload.type === 'incoming-call' 
      ? `Incoming ${payload.callType} call`
      : 'Call ended',
    body: `${payload.fromUsername} is calling...`,
    sound: 'default',
  });
  
  notification.show();
});
```

### Step 5.2: Error Handling

Add user-friendly error messages:

```tsx
function CallErrorToast({ error }: { error: CallError }) {
  const errorMessages = {
    'permission-denied': 'Microphone access denied. Please allow in settings.',
    'network-error': 'Network error. Check your connection.',
    'peer-error': 'Connection failed. Try again.',
    'timeout': 'Call timed out.',
    'unknown': 'An error occurred.',
  };
  
  return (
    <Toast>
      {errorMessages[error.code]}
    </Toast>
  );
}
```

### Step 5.3: Testing Checklist

**Basic Functionality:**
- [ ] Test audio-only calls between two users
- [ ] Test video calls between two users
- [ ] Test call decline/hangup
- [ ] Test call timeout (no answer)
- [ ] Test "busy" scenario (call while already on call)
- [ ] Verify media devices cleanup on hangup

**Critical Fixes:**
- [ ] **ICE Buffering**: Start call, check browser console for "Flushing X buffered ICE candidates"
- [ ] **ICE Batching**: During connection, verify < 5 signaling posts sent (not 15-20)
- [ ] **Device Switching**: During active call, switch microphone/camera - verify audio/video continues
- [ ] **Remote Stream**: Video calls should wait for both audio + video tracks before rendering
- [ ] **Multi-Tab**: Open two browser tabs, initiate call - only one should show active state
- [ ] **Page Refresh**: Refresh during call - should prompt to reconnect (within 5 min)
- [ ] **Sender Validation**: Manually send spoofed signaling message - should be ignored
- [ ] **ICE Restart**: During call, change network (WiFi → Ethernet) - call should auto-recover

**Network Conditions:**
- [ ] Test with different network conditions (use Chrome DevTools throttling)
- [ ] Test on VPN (your primary use case)
- [ ] Test with restrictive firewall (block some STUN servers)
- [ ] Test symmetric NAT (may need TURN)
- [ ] Verify STUN server fallback if one fails

**Browser Compatibility:**
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (has WebRTC quirks)

**Error Handling:**
- [ ] Microphone permissions denied
- [ ] Camera permissions denied (video call)
- [ ] No microphone detected
- [ ] Network disconnection during call
- [ ] Mattermost WebSocket disconnection

**VPN-Specific Tests:**
- [ ] Both users on same VPN
- [ ] One user on VPN, one off VPN
- [ ] User disconnects from VPN during call
- [ ] User reconnects to VPN during call

---

## Deployment Checklist

### Pre-Production

- [ ] Test on different networks (home, office, mobile hotspot)
- [ ] Verify STUN servers are accessible
- [ ] Document network requirements for users
- [ ] Add telemetry for call quality monitoring
- [ ] Set up error tracking (Sentry, etc.)
- [ ] **Test with regular Mattermost users** - verify message visibility
- [ ] **Document expected behavior** for mixed user base
- [ ] **Add user education materials** about call signaling messages

### Production

- [ ] Deploy with STUN-only first
- [ ] Monitor call success rate
- [ ] If < 85% success, add TURN server
- [ ] Document TURN server setup in README
- [ ] Add settings page for audio/video device selection
- [ ] Add call history/logs (optional)
- [ ] **Communicate to team** about signaling message visibility
- [ ] **Create `/webrtc-help` command** to explain system to users
- [ ] **Monitor user feedback** about message pollution

### Regular Mattermost User Impact

**Before deploying, consider:**

1. **User Awareness:**
   - [ ] All users informed about call signaling messages?
   - [ ] Help documentation written and shared?
   - [ ] Support team trained on expected behavior?

2. **Message Pollution:**
   - [ ] Acceptable for your use case? (internal vs. external)
   - [ ] `from_webhook: 'true'` added to suppress mobile notifications?
   - [ ] Timeline filtering works in Antimatter?

3. **Mixed User Base:**
   - [ ] Percentage of users with Antimatter: ____%
   - [ ] Percentage of users with regular Mattermost: ____%
   - [ ] If >20% regular Mattermost users → consider impact carefully

4. **Fallback Plan:**
   - [ ] If complaints arise, can you quickly disable the feature?
   - [ ] Alternative ready (Jitsi, fixed Mattermost plugin)?

### Post-Deployment Monitoring

**Track these metrics:**

```typescript
// Add to your analytics/telemetry
interface CallMetrics {
  totalCalls: number;
  successfulConnections: number;
  failedConnections: number;
  averageDuration: number;
  userComplaints: number; // Manual tracking
  messageSpamReports: number; // Track feedback
}
```

**Red flags to watch for:**
- Call success rate < 85%
- User complaints about "message spam"
- Support tickets about "weird call messages"
- Mobile users reporting notification spam
- Regular Mattermost users confused by signaling messages

### Rollback Plan

If signaling message pollution becomes problematic:

1. **Immediate:** Disable call feature via feature flag
2. **Short-term:** Deploy Mattermost server plugin to hide messages
3. **Long-term:** Migrate to WebSocket custom events (Option 5)

---

## Alternative Solutions (Before You Start)

### Why the Mattermost Calls Plugin Fails

The Mattermost Calls plugin likely fails because:
1. **No TURN server configured** - Most corporate/VPN networks have restrictive NAT
2. **Mattermost server can't reach STUN servers** - Outbound UDP blocked
3. **Clients can't reach the call server** - Firewall rules

### Should You Build Custom WebRTC or Use Something Else?

**✅ Build Custom WebRTC If:**
- All users are on the same VPN (private network)
- You control the network infrastructure
- You can configure firewall rules for STUN/TURN
- You want full control and no external dependencies

**❌ Consider Alternatives If:**
- Users are on different networks/VPNs
- You can't configure network infrastructure
- You need screen sharing, recording, or group calls soon
- You don't have time for 6-8 weeks of development

### Alternative 1: Fix Mattermost Calls Plugin

**Pros:**
- Already built and maintained
- Screen sharing, group calls included
- Better mobile support

**Cons:**
- Requires configuring TURN server (coturn, Twilio, etc.)
- May require Mattermost server changes
- Less control

**How to fix:**
1. Deploy coturn TURN server on your VPN
2. Configure Mattermost Calls plugin with TURN credentials
3. Open UDP ports 3478-3479 for TURN
4. Test with clients on different networks

See: https://github.com/mattermost/mattermost-plugin-calls

### Alternative 2: Embed Jitsi Meet

**Pros:**
- Open source, battle-tested
- Screen sharing, recording, breakout rooms
- Can self-host or use jitsi.org

**Cons:**
- Separate UI (iframe/new tab)
- Heavier than WebRTC-only solution
- Requires Jitsi server setup for self-hosting

**Implementation:**
```typescript
// Create Jitsi room for DM
function startJitsiCall(userId: string, username: string) {
  const roomName = `antimatter-${[currentUserId, userId].sort().join('-')}`;
  const jitsiUrl = `https://meet.jit.si/${roomName}`;
  
  // Option 1: Open in new window
  window.open(jitsiUrl, '_blank');
  
  // Option 2: Embed in app
  const iframe = document.createElement('iframe');
  iframe.src = jitsiUrl;
  iframe.allow = 'camera; microphone';
  document.body.appendChild(iframe);
}
```

### Alternative 3: Use Daily.co or Whereby

**Pros:**
- Fully managed, no infrastructure
- Drop-in video components
- Free tier available

**Cons:**
- External dependency
- Privacy concerns (calls go through their servers)
- Costs scale with usage

### Alternative 4: Simple SIP/VoIP Integration

If you only need audio calls (no video):

**Pros:**
- Mature, stable protocols
- Can integrate with existing phone systems
- Lower bandwidth than video

**Cons:**
- Requires SIP server (Asterisk, FreeSWITCH)
- More complex than WebRTC
- No built-in video path

### Recommendation for VPN Environment

**Since you're on a VPN:**

1. **Try fixing Mattermost Calls first** (2-3 days):
   - Deploy coturn on VPN
   - Configure Mattermost plugin
   - Test with 2-3 users
   - If it works → you're done! 

2. **If that fails, build custom WebRTC** (6-8 weeks):
   - You have VPN advantage (easier NAT traversal)
   - Test STUN-only first (may be enough!)
   - Add TURN only if needed
   - Follow this guide

3. **If you need it working this week**:
   - Use Jitsi Meet (embed or link out)
   - Takes 1-2 days to integrate
   - Not as polished but functional

---

## Timeline Estimate

- **Phase 1 (Foundation):** 2-3 days
- **Phase 2 (WebRTC Core):** 5-7 days
- **Phase 3 (UI Components):** 3-4 days
- **Phase 4 (Integration):** 2-3 days
- **Phase 5 (Polish & Testing):** 3-5 days

**Total: 3-4 weeks for production-ready audio/video calls**

---

## Resources

- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [WebRTC Samples](https://webrtc.github.io/samples/)
- [Mattermost API Docs](https://api.mattermost.com/)
- [coturn TURN Server](https://github.com/coturn/coturn)

---

## Support & Troubleshooting

### Common Issues

**Issue: "Permission denied" error**
- Solution: Check browser/OS permissions for microphone/camera

**Issue: Calls fail to connect**
- Solution: Check STUN server accessibility, consider adding TURN

**Issue: Poor audio quality**
- Solution: Check network bandwidth, adjust audio constraints

**Issue: Echo/feedback**
- Solution: Enable echo cancellation in audio constraints

**Issue: ICE candidates not exchanged**
- Solution: Verify WebSocket connection, check signaling messages

---

## Next Steps After MVP

1. **Group Calls** - Add mesh topology for 3-4 participants
2. **Screen Sharing** - Use `getDisplayMedia()` API
4. **Call History** - Log calls in local storage
5. **Push-to-Talk** - Add PTT mode for group calls
6. **Noise Suppression** - Use WebRTC processing
