/**
 * Synchronization manager for WebRTC and audio/video synchronization.
 * Handles network delay detection, state reconciliation, and timing management.
 */

export class SyncManager {
  private lastLatencyMs = 0;
  private latencyHistory: number[] = [];
  private readonly MAX_HISTORY = 10;

  /**
   * Records network round-trip time and calculates average latency
   */
  recordLatency(ms: number) {
    this.lastLatencyMs = ms;
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > this.MAX_HISTORY) {
      this.latencyHistory.shift();
    }
    console.log(`[SyncManager] Latency: ${ms}ms, Average: ${this.getAverageLatency()}ms`);
  }

  /**
   * Get average latency over recent measurements
   */
  getAverageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyHistory.length);
  }

  /**
   * Detect if network is experiencing degradation
   */
  isNetworkDegraded(): boolean {
    const avg = this.getAverageLatency();
    return avg > 500; // > 500ms is degraded
  }

  /**
   * Get recommended timeout based on current latency
   */
  getAdjustedTimeout(baseMs: number): number {
    const avg = this.getAverageLatency();
    // Add buffer based on latency
    return baseMs + Math.min(avg * 3, 5000); // Max +5s buffer
  }

  /**
   * Reset latency tracking
   */
  reset() {
    this.latencyHistory = [];
    this.lastLatencyMs = 0;
  }
}

export const syncManager = new SyncManager();
