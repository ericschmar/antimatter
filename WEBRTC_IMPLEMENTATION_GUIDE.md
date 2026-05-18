# WebRTC Implementation Guide - Option A: Direct Calls via Mattermost Signaling

Complete implementation guide for adding serverless voice/video calls to Antimatter.

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
│   │   ├── IncomingCallModal.tsx   # Accept/decline UI
│   │   ├── ActiveCallPanel.tsx     # During-call controls
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
  
  // For 'offer' and 'answer'
  sdp?: string;
  callType?: CallType;
  
  // For 'ice-candidate'
  candidate?: RTCIceCandidateInit;
  
  // For 'decline'
  reason?: 'busy' | 'declined' | 'timeout';
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
   */
  async switchMicrophone(deviceId: string): Promise<void> {
    if (!this.stream) return;

    const audioTrack = this.stream.getAudioTracks()[0];
    const constraints = {
      audio: { deviceId: { exact: deviceId } },
      video: false,
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newAudioTrack = newStream.getAudioTracks()[0];

    // Replace track in existing stream
    this.stream.removeTrack(audioTrack);
    this.stream.addTrack(newAudioTrack);
    audioTrack.stop();
  }

  /**
   * Switch to a different camera
   */
  async switchCamera(deviceId: string): Promise<void> {
    if (!this.stream) return;

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) return;

    const constraints = {
      audio: false,
      video: { deviceId: { exact: deviceId } },
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newVideoTrack = newStream.getVideoTracks()[0];

    // Replace track in existing stream
    this.stream.removeTrack(videoTrack);
    this.stream.addTrack(newVideoTrack);
    videoTrack.stop();
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
 */
export class CallSignaling {
  constructor(
    private mattermostApi: MattermostApiClient,
    private onMessage: (message: SignalingMessage, channelId: string) => void
  ) {}

  /**
   * Send a signaling message via Mattermost DM
   */
  async send(
    message: SignalingMessage,
    channelId: string
  ): Promise<void> {
    const post: Partial<CallPost> = {
      channel_id: channelId,
      message: this.getHumanReadableMessage(message),
      type: 'custom_webrtc_call',
      props: message,
    };

    try {
      await this.mattermostApi.createPost(post);
    } catch (error) {
      console.error('Failed to send signaling message:', error);
      throw new Error('Failed to send call signaling');
    }
  }

  /**
   * Handle incoming post - check if it's a signaling message
   */
  handlePost(post: any): boolean {
    // Check if this is a call signaling message
    if (post.type !== 'custom_webrtc_call') {
      return false;
    }

    const message = post.props as SignalingMessage;
    
    // Validate message
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

    // Validate action-specific fields
    switch (message.action) {
      case 'offer':
      case 'answer':
        return typeof message.sdp === 'string' && !!message.callType;
      case 'ice-candidate':
        return !!message.candidate;
      case 'hangup':
      case 'decline':
        return true;
      default:
        return false;
    }
  }

  private getHumanReadableMessage(message: SignalingMessage): string {
    // These messages won't be shown in the timeline (custom type)
    // but include a readable message for logs/debugging
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
  
  // Event callbacks
  private events: Partial<CallEvents> = {};

  constructor(
    mattermostApi: any,
    config: Partial<CallConfig> = {}
  ) {
    this.config = { ...DEFAULT_CALL_CONFIG, ...config };
    this.mediaManager = new MediaDevicesManager();
    this.signaling = new CallSignaling(
      mattermostApi,
      this.handleSignalingMessage.bind(this)
    );
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
    this.signaling.handlePost(post);
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

    // Handle remote tracks
    this.peerConnection.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (this.events.onRemoteStream) {
        this.events.onRemoteStream(event.streams[0]);
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

    // Handle ICE connection state
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection!.iceConnectionState;
      console.log('ICE connection state:', state);

      if (state === 'failed') {
        this.handleError({
          code: 'network-error',
          message: 'Failed to establish connection. This may be due to firewall or network restrictions.',
          fatal: true,
        });
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
   * Handle incoming ICE candidate
   */
  private async handleIceCandidate(message: SignalingMessage): Promise<void> {
    if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
      return;
    }

    if (!this.peerConnection) {
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(
        new RTCIceCandidate(message.candidate!)
      );
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
      // Don't treat as fatal - some candidates may fail
    }
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

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Release media devices
    this.mediaManager.cleanup();

    // Clear session
    this.currentSession = null;

    // Update state
    this.setState('idle');

    // Notify
    if (this.events.onCallEnded) {
      this.events.onCallEnded(reason);
    }
  }
}

// Export singleton or factory
export function createCallManager(
  mattermostApi: any,
  config?: Partial<CallConfig>
): CallManager {
  return new CallManager(mattermostApi, config);
}
```

---

## Phase 3: UI Components

See the guide for complete UI component implementation including:

- **CallContext.tsx** - React Context provider for global call state
- **CallButton.tsx** - Button to initiate calls
- **IncomingCallModal.tsx** - Modal for accepting/declining incoming calls
- **ActiveCallPanel.tsx** - Controls during active call (mute, hangup, etc.)

---

## Phase 4: Integration

### Step 4.1: Initialize CallManager

In your main app initialization (e.g., `src/mainview/index.tsx`):

```typescript
import { createCallManager } from './webrtc/CallManager';
import { CallProvider } from './contexts/CallContext';

// Create call manager instance
const callManager = createCallManager(mattermostApi);

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
      return; // Don't show as regular message
    }
    
    // Regular message handling...
  }
}
```

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

### Step 4.4: Add Incoming Call Handler

In your root component:

```tsx
import { IncomingCallModal } from './components/IncomingCallModal';
import { ActiveCallPanel } from './components/ActiveCallPanel';
import { useCall } from './contexts/CallContext';

function App() {
  const { state, session } = useCall();
  
  return (
    <>
      {/* Your existing app */}
      
      {/* Call UI overlays */}
      <IncomingCallModal 
        callerName={getCallerName(session?.otherUserId)}
        callerAvatar={getCallerAvatar(session?.otherUserId)}
      />
      
      {state === 'connected' && (
        <ActiveCallPanel
          callerName={getCallerName(session?.otherUserId)}
        />
      )}
    </>
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

- [ ] Test audio-only calls between two users
- [ ] Test call decline/hangup
- [ ] Test call timeout (no answer)
- [ ] Test "busy" scenario (call while already on call)
- [ ] Test network interruption/reconnection
- [ ] Test microphone permissions denied
- [ ] Test with different network conditions
- [ ] Test STUN server fallback
- [ ] Test ICE candidate exchange
- [ ] Verify media devices cleanup on hangup

---

## Deployment Checklist

### Pre-Production

- [ ] Test on different networks (home, office, mobile hotspot)
- [ ] Verify STUN servers are accessible
- [ ] Document network requirements for users
- [ ] Add telemetry for call quality monitoring
- [ ] Set up error tracking (Sentry, etc.)

### Production

- [ ] Deploy with STUN-only first
- [ ] Monitor call success rate
- [ ] If < 85% success, add TURN server
- [ ] Document TURN server setup in README
- [ ] Add settings page for audio/video device selection
- [ ] Add call history/logs (optional)

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
3. **Call Recording** - Use MediaRecorder API
4. **Call History** - Log calls in local storage
5. **Push-to-Talk** - Add PTT mode for group calls
6. **Noise Suppression** - Use WebRTC processing or ML models
7. **Virtual Backgrounds** - Canvas API + ML for background replacement
