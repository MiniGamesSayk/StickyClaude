import type { GameClient } from '../net/client.ts';

const N = 120;
const SAMPLE_MS = 100;

interface Series {
  label: string;
  unit: string;
  color: string;
  data: Float64Array;
  max: number;
}

function series(label: string, unit: string, color: string, max: number): Series {
  return { label, unit, color, data: new Float64Array(N), max };
}

/** Graphe réseau en surimpression : RTT, débit, corrections, tampon d'interpolation, avance. */
export class NetGraph {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rtt = series('RTT', 'ms', '#6bd0ff', 400);
  private readonly down = series('↓ débit', 'Ko/s', '#7dff9b', 40);
  private readonly up = series('↑ débit', 'Ko/s', '#ffd36b', 40);
  private readonly corr = series('corrections', '/s', '#ff7b7b', 6);
  private readonly buf = series('interpolation', 'ms', '#c9a0ff', 400);
  private readonly lead = series('avance', 'ticks', '#ffb36b', 20);
  private last = { t: 0, bin: 0, bout: 0, corr: 0 };
  private head = 0;
  private errUnits = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly client: GameClient,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D indisponible');
    this.ctx = ctx;
  }

  update(now: number): void {
    if (this.canvas.hidden) return;
    const st = this.client.stats;
    if (now - this.last.t < SAMPLE_MS) return;
    const dt = this.last.t === 0 ? 1 : (now - this.last.t) / 1000;
    const i = this.head;
    this.rtt.data[i] = st.rttMs;
    this.down.data[i] = (st.bytesIn - this.last.bin) / dt / 1024;
    this.up.data[i] = (st.bytesOut - this.last.bout) / dt / 1024;
    this.corr.data[i] = (st.corrections - this.last.corr) / dt;
    this.buf.data[i] = st.interpMs;
    this.lead.data[i] = st.leadTicks;
    this.errUnits = st.lastErrorUnits;
    this.last = { t: now, bin: st.bytesIn, bout: st.bytesOut, corr: st.corrections };
    this.head = (i + 1) % N;
    this.draw();
  }

  private draw(): void {
    const c = this.ctx;
    const st = this.client.stats;
    const W = this.canvas.width;
    const all = [this.rtt, this.down, this.up, this.corr, this.buf, this.lead];
    const rowH = 30;
    c.clearRect(0, 0, W, this.canvas.height);
    c.font = '11px ui-monospace, monospace';
    all.forEach((s, k) => {
      const y0 = 8 + k * rowH;
      const last = s.data[(this.head - 1 + N) % N];
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.strokeRect(6.5, y0 + 0.5, W - 12, rowH - 6);
      c.strokeStyle = s.color;
      c.beginPath();
      for (let j = 0; j < N; j++) {
        const v = s.data[(this.head + j) % N];
        const x = 8 + (j / (N - 1)) * (W - 16);
        const y = y0 + rowH - 7 - Math.min(1, v / s.max) * (rowH - 9);
        if (j === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      c.fillStyle = s.color;
      c.fillText(`${s.label} ${last.toFixed(s.max <= 20 ? 1 : 0)} ${s.unit}`, 12, y0 + 11);
    });
    c.fillStyle = '#dfe6ff';
    const y = 8 + all.length * rowH + 6;
    c.fillText(
      `prédit ${st.predTick} · serveur ≈ ${st.serverTick.toFixed(1)} · marge ${st.margin === 127 ? '–' : st.margin}`,
      8,
      y,
    );
    c.fillText(
      `corrections ${st.corrections} (écart ${this.errUnits.toFixed(1)} u) · resync ${st.resyncs} · gigue ${st.jitterMs.toFixed(0)} ms`,
      8,
      y + 14,
    );
    c.fillText(`snapshots ${st.snapshots} · tampon ${st.bufferMs.toFixed(0)} ms`, 8, y + 28);
  }
}
