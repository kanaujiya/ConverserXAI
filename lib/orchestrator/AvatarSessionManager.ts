/**
 * Avatar Session Manager
 * Maintains persistent WebRTC connection to D-ID avatar
 * Implements automatic reconnect, heartbeat, and stream recovery
 */

export interface AvatarSessionConfig {
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  reconnectBackoffMs?: number;
  sessionTimeoutMs?: number;
  streamMonitorInterval?: number;
}

export type SessionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export type StreamState = 'inactive' | 'active' | 'error';
export type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type IceConnectionState = 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';

export interface StreamMonitorMetrics {
  peerConnectionState: PeerConnectionState | null;
  iceConnectionState: IceConnectionState | null;
  remoteStreamActive: boolean;
  audioTracksActive: number;
  videoTracksActive: number;
  lastMonitorTime: number;
  reconnectTriggeredCount: number;
}

interface SessionMetrics {
  createdAt: number;
  lastHeartbeat: number;
  connectionAttempts: number;
  reconnectionAttempts: number;
  totalUptime: number;
}

// WebRTC stream monitoring
interface StreamMonitor {
  intervalId: NodeJS.Timeout | null;
  metrics: StreamMonitorMetrics;
}

const DEFAULT_STREAM_MONITOR_METRICS: StreamMonitorMetrics = {
  peerConnectionState: null,
  iceConnectionState: null,
  remoteStreamActive: false,
  audioTracksActive: 0,
  videoTracksActive: 0,
  lastMonitorTime: 0,
  reconnectTriggeredCount: 0,
};

export class AvatarSessionManager {
  private sessionId: string | null = null;
  private state: SessionState = 'disconnected';
  private config: Required<AvatarSessionConfig>;
  private metrics: SessionMetrics = {
    createdAt: 0,
    lastHeartbeat: 0,
    connectionAttempts: 0,
    reconnectionAttempts: 0,
    totalUptime: 0,
  };

  private streamMonitor: StreamMonitor = {
    intervalId: null,
    metrics: { ...DEFAULT_STREAM_MONITOR_METRICS },
  };

  private stateListeners: Array<(state: SessionState) => void> = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private upTimeStarted: number = 0;

  // WebRTC peer connection (if available for monitoring)
  private peerConnection: RTCPeerConnection | null = null;

  // External callbacks
  private readonly createSession: () => Promise<string>;
  private readonly sendHeartbeat: (sessionId: string) => Promise<void>;
  private readonly closeSession: (sessionId: string) => Promise<void>;
  private readonly checkConnection: (sessionId: string) => Promise<boolean>;
  private readonly getPeerConnection?: () => RTCPeerConnection | null;

  constructor(
    createSession: () => Promise<string>,
    sendHeartbeat: (sessionId: string) => Promise<void>,
    closeSession: (sessionId: string) => Promise<void>,
    checkConnection: (sessionId: string) => Promise<boolean>,
    config: AvatarSessionConfig = {},
    getPeerConnection?: () => RTCPeerConnection | null
  ) {
    this.createSession = createSession;
    this.sendHeartbeat = sendHeartbeat;
    this.closeSession = closeSession;
    this.checkConnection = checkConnection;
    this.getPeerConnection = getPeerConnection;

    this.config = {
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      heartbeatInterval: config.heartbeatInterval || 30000, // 30 seconds
      reconnectBackoffMs: config.reconnectBackoffMs || 1000, // 1 second
      sessionTimeoutMs: config.sessionTimeoutMs || 600000, // 10 minutes
      streamMonitorInterval: config.streamMonitorInterval || 3000, // 3 seconds
    };
  }

  /**
   * Initialize/create persistent session
   */
  public async initialize(): Promise<void> {
    console.log('[AvatarSession] Initializing session');

    if (this.state !== 'disconnected') {
      console.warn('[AvatarSession] Session already initialized');
      return;
    }

    this.setState('connecting');

    try {
      this.metrics.connectionAttempts++;
      this.sessionId = await this.createSession();
      this.upTimeStarted = Date.now();
      this.metrics.createdAt = Date.now();

      console.log('[AvatarSession] Session created:', this.sessionId);

      this.setState('connected');

      // Start heartbeat to keep session alive
      this.startHeartbeat();

      // Start stream monitoring to detect connection issues
      this.startStreamMonitoring();
    } catch (error) {
      console.error('[AvatarSession] Failed to initialize:', error);
      this.setState('error');
      throw error;
    }
  }

  /**
   * Get current session ID
   */
  public getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if session is active
   */
  public isActive(): boolean {
    return this.state === 'connected' && !!this.sessionId;
  }

  /**
   * Get current state
   */
  public getState(): SessionState {
    return this.state;
  }

  /**
   * Handle heartbeat
   */
  private async sendHeartbeatPing(): Promise<void> {
    if (!this.sessionId) {
      console.warn('[AvatarSession] No session to heartbeat');
      return;
    }

    try {
      await this.sendHeartbeat(this.sessionId);
      this.metrics.lastHeartbeat = Date.now();

      // Verify connection
      const isConnected = await this.checkConnection(this.sessionId);
      if (!isConnected) {
        console.warn('[AvatarSession] Connection check failed, triggering reconnect');
        this.reconnect();
      }
    } catch (error) {
      console.error('[AvatarSession] Heartbeat failed:', error);
      this.reconnect();
    }
  }

  /**
   * Start periodic heartbeat
   */
  private startHeartbeat(): void {
    console.log('[AvatarSession] Starting heartbeat');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeatPing();
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  public reconnect(): void {
    if (this.state === 'reconnecting' || this.state === 'connecting') {
      console.log('[AvatarSession] Already reconnecting');
      return;
    }

    console.log('[AvatarSession] Attempting reconnection');
    this.setState('reconnecting');
    this.metrics.reconnectionAttempts++;

    // Calculate backoff delay
    const delayMs = this.config.reconnectBackoffMs * Math.pow(2, this.metrics.reconnectionAttempts - 1);
    const cappedDelayMs = Math.min(delayMs, 30000); // Cap at 30 seconds

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
    }

    this.reconnectTimeoutId = setTimeout(async () => {
      try {
        await this.initialize();
        this.metrics.reconnectionAttempts = 0; // Reset on success
        console.log('[AvatarSession] Reconnection successful');
      } catch (error) {
        if (this.metrics.reconnectionAttempts >= this.config.maxReconnectAttempts) {
          console.error(
            '[AvatarSession] Max reconnection attempts reached',
            this.metrics.reconnectionAttempts
          );
          this.setState('error');
        } else {
          console.log('[AvatarSession] Reconnection failed, will retry');
          this.reconnect();
        }
      }
    }, cappedDelayMs);
  }

  /**
   * Close session
   */
  public async close(): Promise<void> {
    console.log('[AvatarSession] Closing session');

    this.stopHeartbeat();
    this.stopStreamMonitoring();

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
    }

    if (this.sessionId) {
      try {
        await this.closeSession(this.sessionId);
      } catch (error) {
        console.error('[AvatarSession] Error closing session:', error);
      }
    }

    this.setState('disconnected');
    this.sessionId = null;

    // Record uptime
    if (this.upTimeStarted) {
      this.metrics.totalUptime += Date.now() - this.upTimeStarted;
    }
  }

  /**
   * Start stream monitoring to detect connection issues
   */
  private startStreamMonitoring(): void {
    if (this.streamMonitor.intervalId) {
      clearInterval(this.streamMonitor.intervalId);
    }

    console.log('[AvatarSession] Starting stream monitoring');

    this.streamMonitor.intervalId = setInterval(() => {
      this.checkStreamHealth();
    }, this.config.streamMonitorInterval);
  }

  /**
   * Stop stream monitoring
   */
  private stopStreamMonitoring(): void {
    if (this.streamMonitor.intervalId) {
      clearInterval(this.streamMonitor.intervalId);
      this.streamMonitor.intervalId = null;
    }

    console.log('[AvatarSession] Stopping stream monitoring');
  }

  /**
   * Check WebRTC stream health
   */
  private checkStreamHealth(): void {
    if (!this.sessionId || this.state !== 'connected') {
      return;
    }

    try {
      // Try to get peer connection if available
      if (this.getPeerConnection) {
        const pc = this.getPeerConnection();
        if (pc) {
          this.monitorPeerConnection(pc);
        }
      }

      this.streamMonitor.metrics.lastMonitorTime = Date.now();
    } catch (error) {
      console.error('[AvatarSession] Error during stream health check:', error);
    }
  }

  /**
   * Monitor peer connection state
   */
  private monitorPeerConnection(pc: RTCPeerConnection): void {
    const oldPcState = this.streamMonitor.metrics.peerConnectionState;
    const oldIceState = this.streamMonitor.metrics.iceConnectionState;

    this.streamMonitor.metrics.peerConnectionState = pc.connectionState as PeerConnectionState;
    this.streamMonitor.metrics.iceConnectionState = pc.iceConnectionState as IceConnectionState;

    // Count active tracks
    const remoteStreams = pc.getReceivers();
    let audioTracks = 0;
    let videoTracks = 0;

    remoteStreams.forEach(receiver => {
      if (receiver.track) {
        if (receiver.track.kind === 'audio' && receiver.track.enabled) audioTracks++;
        if (receiver.track.kind === 'video' && receiver.track.enabled) videoTracks++;
      }
    });

    this.streamMonitor.metrics.audioTracksActive = audioTracks;
    this.streamMonitor.metrics.videoTracksActive = videoTracks;
    this.streamMonitor.metrics.remoteStreamActive = audioTracks > 0 || videoTracks > 0;

    // Detect state changes that indicate connection issues
    if (
      oldPcState !== this.streamMonitor.metrics.peerConnectionState ||
      oldIceState !== this.streamMonitor.metrics.iceConnectionState
    ) {
      console.log('[AvatarSession] Connection state changed:', {
        pc: oldPcState + ' → ' + this.streamMonitor.metrics.peerConnectionState,
        ice: oldIceState + ' → ' + this.streamMonitor.metrics.iceConnectionState,
      });
    }

    // Trigger reconnection if connection failed
    if (
      this.streamMonitor.metrics.peerConnectionState === 'failed' ||
      this.streamMonitor.metrics.peerConnectionState === 'disconnected' ||
      this.streamMonitor.metrics.iceConnectionState === 'failed'
    ) {
      console.warn('[AvatarSession] Peer connection failed, triggering reconnect');
      this.streamMonitor.metrics.reconnectTriggeredCount++;
      this.reconnect();
    }
  }

  /**
   * Get stream monitor metrics
   */
  public getStreamMetrics(): StreamMonitorMetrics {
    return { ...this.streamMonitor.metrics };
  }

  /**
   * Set state and notify listeners
   */
  private setState(newState: SessionState): void {
    if (this.state === newState) {
      return;
    }

    console.log('[AvatarSession] State changed:', this.state, '→', newState);
    this.state = newState;

    this.stateListeners.forEach(listener => listener(newState));
  }

  /**
   * Subscribe to state changes
   */
  public onStateChange(listener: (state: SessionState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  /**
   * Get session metrics
   */
  public getMetrics(): SessionMetrics {
    return {
      ...this.metrics,
      totalUptime: this.metrics.totalUptime + (this.upTimeStarted ? Date.now() - this.upTimeStarted : 0),
    };
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      sessionId: this.sessionId,
      state: this.state,
      metrics: this.getMetrics(),
      streamMetrics: this.getStreamMetrics(),
      config: this.config,
    };
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    console.log('[AvatarSession] Destroying session manager');
    this.close();
    this.stopStreamMonitoring();
    this.stateListeners = [];
  }
}
