import { Injectable } from '@nestjs/common';

// In-process delivery counters; a restart resets them, which is acceptable
// because the signal that matters is "failing right now".
@Injectable()
export class MailMetrics {
  private sent = 0;
  private failed = 0;
  private lastSuccessAt: Date | null = null;
  private lastFailureAt: Date | null = null;

  recordSuccess() {
    this.sent += 1;
    this.lastSuccessAt = new Date();
  }

  recordFailure() {
    this.failed += 1;
    this.lastFailureAt = new Date();
  }

  snapshot() {
    const degraded =
      this.lastFailureAt !== null &&
      (this.lastSuccessAt === null || this.lastFailureAt > this.lastSuccessAt);
    return {
      status: degraded ? 'degraded' : 'ok',
      sent: this.sent,
      failed: this.failed,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
    };
  }
}
