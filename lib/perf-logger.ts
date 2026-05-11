/**
 * PerfLogger — lightweight pipeline timing utility
 * 
 * Usage:
 *   const t = PerfLogger.start('my-pipeline');
 *   PerfLogger.mark(t, 'step-1');
 *   PerfLogger.mark(t, 'step-2');
 *   PerfLogger.end(t);
 * 
 * Output in console:
 *   [⏱ my-pipeline] step-1: 123ms | step-2: +45ms | TOTAL: 168ms
 */
export class PerfLogger {
  static start(label: string): { label: string; t0: number; last: number } {
    const t0 = Date.now();
    console.log(`%c[⏱ ${label}] ▶ Started`, 'color:#6ee7b7;font-weight:bold');
    return { label, t0, last: t0 };
  }

  static mark(
    ctx: { label: string; t0: number; last: number },
    step: string,
    extra?: Record<string, unknown>
  ): void {
    const now = Date.now();
    const sinceStart = now - ctx.t0;
    const sinceLast = now - ctx.last;
    ctx.last = now;
    const extraStr = extra ? ` | ${JSON.stringify(extra)}` : '';
    console.log(
      `%c[⏱ ${ctx.label}] ${step}: +${sinceLast}ms (total ${sinceStart}ms)${extraStr}`,
      'color:#fcd34d'
    );
  }

  static end(ctx: { label: string; t0: number; last: number }, note?: string): void {
    const total = Date.now() - ctx.t0;
    console.log(
      `%c[⏱ ${ctx.label}] ✅ DONE in ${total}ms${note ? ` — ${note}` : ''}`,
      'color:#34d399;font-weight:bold'
    );
  }

  static error(ctx: { label: string; t0: number; last: number }, msg: string): void {
    const total = Date.now() - ctx.t0;
    console.error(`[⏱ ${ctx.label}] ❌ FAILED after ${total}ms — ${msg}`);
  }
}
