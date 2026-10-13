import Stats from 'stats.js';
import { ReceiverMetrics } from './types';

export class HudManager {
  private stats: Stats;
  private statusEl: HTMLElement | null;
  private seqEl: HTMLElement | null;
  private deltasEl: HTMLElement | null;
  private rateEl: HTMLElement | null;
  private reductionEl: HTMLElement | null;

  private lastDomUpdateTime = 0;
  private domUpdateIntervalMs = 100; // Throttle DOM updates to 10 Hz to prevent layout thrashing

  constructor() {
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb

    const statsContainer = document.getElementById('stats-container');
    if (statsContainer) {
      this.stats.dom.style.position = 'relative';
      statsContainer.appendChild(this.stats.dom);
    } else {
      document.body.appendChild(this.stats.dom);
    }

    this.statusEl = document.getElementById('conn-status');
    this.seqEl = document.getElementById('metric-seq');
    this.deltasEl = document.getElementById('metric-deltas');
    this.rateEl = document.getElementById('metric-rate');
    this.reductionEl = document.getElementById('metric-reduction');
  }

  public beginFrame(): void {
    this.stats.begin();
  }

  public endFrame(): void {
    this.stats.end();
  }

  /**
   * Updates telemetry metrics display, throttled to 10 Hz to minimize layout recalculations.
   */
  public update(metrics: ReceiverMetrics): void {
    const now = performance.now();
    if (now - this.lastDomUpdateTime < this.domUpdateIntervalMs) {
      return;
    }
    this.lastDomUpdateTime = now;

    if (this.statusEl) {
      if (metrics.connected) {
        if (!this.statusEl.classList.contains('connected')) {
          this.statusEl.className = 'status-badge connected';
          this.statusEl.textContent = 'CONNECTED';
        }
      } else {
        if (!this.statusEl.classList.contains('disconnected')) {
          this.statusEl.className = 'status-badge disconnected';
          this.statusEl.textContent = 'DISCONNECTED';
        }
      }
    }

    if (this.seqEl) {
      this.seqEl.textContent = metrics.seq > 0 ? `#${metrics.seq.toLocaleString()}` : '--';
    }

    if (this.deltasEl) {
      this.deltasEl.textContent =
        metrics.lastDeltaCount > 0 ? `${metrics.lastDeltaCount} / 1,000` : '--';
    }

    if (this.rateEl) {
      const kbps = (metrics.bytesPerSecond / 1024).toFixed(2);
      this.rateEl.textContent = `${kbps} KB/s`;
    }

    if (this.reductionEl) {
      if (metrics.reductionPercentage > 0) {
        this.reductionEl.textContent = `${metrics.reductionPercentage.toFixed(1)} %`;
      } else {
        this.reductionEl.textContent = '-- %';
      }
    }
  }

  public dispose(): void {
    if (this.stats.dom && this.stats.dom.parentElement) {
      this.stats.dom.parentElement.removeChild(this.stats.dom);
    }
  }
}
