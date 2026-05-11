/**
 * Pipeline Diagnostics & Metrics
 * Comprehensive logging and timing instrumentation for latency analysis
 */

export interface TimingMark {
  name: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface LatencyReport {
  totalTime: number;
  segments: Array<{
    name: string;
    duration: number;
    percentage: number;
  }>;
  bottlenecks: Array<{
    segment: string;
    duration: number;
    severity: 'low' | 'medium' | 'high';
  }>;
}

export class PipelineDiagnostics {
  private marks: Map<string, TimingMark[]> = new Map();
  private readonly MAX_MARKS_PER_KEY = 100;
  private readonly BOTTLENECK_THRESHOLD_MS = 1000;

  constructor() {
    console.log('[Diagnostics] Initialized');
  }

  /**
   * Record a timing mark
   */
  public mark(name: string, metadata?: Record<string, any>): void {
    if (!this.marks.has(name)) {
      this.marks.set(name, []);
    }

    const markList = this.marks.get(name)!;
    markList.push({
      name,
      timestamp: Date.now(),
      metadata,
    });

    // Keep only recent marks
    if (markList.length > this.MAX_MARKS_PER_KEY) {
      markList.shift();
    }

    console.log(
      `[Timing] ${name}`,
      metadata ? JSON.stringify(metadata) : ''
    );
  }

  /**
   * Measure time between two marks
   */
  public measure(
    startMark: string,
    endMark: string,
    label?: string
  ): number | null {
    const starts = this.marks.get(startMark);
    const ends = this.marks.get(endMark);

    if (!starts || !ends || starts.length === 0 || ends.length === 0) {
      return null;
    }

    // Use most recent marks
    const start = starts[starts.length - 1];
    const end = ends[ends.length - 1];

    const duration = end.timestamp - start.timestamp;

    console.log(
      `[Measure] ${label || `${startMark} → ${endMark}`}: ${duration}ms`
    );

    return duration;
  }

  /**
   * Get latency report for a conversation turn
   */
  public getLatencyReport(): LatencyReport {
    const segments: Array<{
      name: string;
      duration: number;
      percentage: number;
    }> = [];

    const pairs = [
      { start: 'transcription-start', end: 'transcription-end', label: 'Transcription' },
      { start: 'ai-start', end: 'ai-end', label: 'AI Response' },
      { start: 'tts-start', end: 'tts-end', label: 'TTS Generation' },
      { start: 'avatar-start', end: 'avatar-end', label: 'Avatar Preparation' },
      { start: 'playback-start', end: 'playback-end', label: 'Playback' },
    ];

    let totalTime = 0;

    for (const pair of pairs) {
      const duration = this.measure(pair.start, pair.end);
      if (duration !== null) {
        segments.push({
          name: pair.label,
          duration,
          percentage: 0,
        });
        totalTime += duration;
      }
    }

    // Calculate percentages
    segments.forEach(seg => {
      seg.percentage = totalTime > 0 ? (seg.duration / totalTime) * 100 : 0;
    });

    // Identify bottlenecks
    const bottlenecks = segments
      .filter(seg => seg.duration > this.BOTTLENECK_THRESHOLD_MS)
      .map(seg => ({
        segment: seg.name,
        duration: seg.duration,
        severity: this.calculateSeverity(seg.duration),
      }));

    return { totalTime, segments, bottlenecks };
  }

  /**
   * Calculate severity of bottleneck
   */
  private calculateSeverity(duration: number): 'low' | 'medium' | 'high' {
    if (duration > 3000) return 'high';
    if (duration > 2000) return 'medium';
    return 'low';
  }

  /**
   * Get human-readable diagnostics report
   */
  public getDiagnosticsReport(): string {
    const report = this.getLatencyReport();

    let text = '\n╔════════════════════════════════════════╗\n';
    text += '║        PIPELINE DIAGNOSTICS REPORT     ║\n';
    text += '╚════════════════════════════════════════╝\n\n';

    text += '📊 TIMING BREAKDOWN:\n';
    text += '─────────────────────────────────────────\n';

    report.segments.forEach(seg => {
      const barLength = Math.round(seg.percentage / 2);
      const bar = '█'.repeat(barLength) + '░'.repeat(50 - barLength);
      text += `  ${seg.name.padEnd(20)} │${bar}│ ${seg.duration.toFixed(0).padStart(5)}ms (${seg.percentage.toFixed(1)}%)\n`;
    });

    text += `\n  Total Pipeline Time: ${report.totalTime.toFixed(0)}ms\n`;

    if (report.bottlenecks.length > 0) {
      text += '\n⚠️  BOTTLENECKS DETECTED:\n';
      text += '─────────────────────────────────────────\n';

      report.bottlenecks.forEach(bn => {
        const icon =
          bn.severity === 'high' ? '🔴' : bn.severity === 'medium' ? '🟡' : '🟢';
        text += `  ${icon} ${bn.segment}: ${bn.duration.toFixed(0)}ms (${bn.severity})\n`;
      });
    } else {
      text += '\n✅ No significant bottlenecks detected\n';
    }

    text += '\n═════════════════════════════════════════\n';

    return text;
  }

  /**
   * Print diagnostics report to console
   */
  public printReport(): void {
    console.log(this.getDiagnosticsReport());
  }

  /**
   * Clear all marks
   */
  public clear(): void {
    this.marks.clear();
    console.log('[Diagnostics] Marks cleared');
  }

  /**
   * Get raw marks data
   */
  public getMarks(): Record<string, TimingMark[]> {
    const result: Record<string, TimingMark[]> = {};
    this.marks.forEach((marks, key) => {
      result[key] = [...marks];
    });
    return result;
  }

  /**
   * Export diagnostics as JSON
   */
  public exportJSON(): string {
    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        marks: this.getMarks(),
        report: this.getLatencyReport(),
      },
      null,
      2
    );
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      marksCount: this.marks.size,
      report: this.getLatencyReport(),
    };
  }
}

// Export singleton instance
export const pipelineDiagnostics = new PipelineDiagnostics();
