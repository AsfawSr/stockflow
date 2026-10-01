import { MailMetrics } from '../src/health/mail-metrics.service';

describe('MailMetrics', () => {
  it('starts healthy with zero counters', () => {
    expect(new MailMetrics().snapshot()).toEqual({
      status: 'ok',
      sent: 0,
      failed: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
    });
  });

  it('degrades when the most recent delivery failed and recovers on success', () => {
    const metrics = new MailMetrics();
    metrics.recordSuccess();
    expect(metrics.snapshot()).toMatchObject({ status: 'ok', sent: 1, failed: 0 });
    metrics.recordFailure();
    const degraded = metrics.snapshot();
    expect(degraded).toMatchObject({ status: 'degraded', sent: 1, failed: 1 });
    expect(degraded.lastFailureAt).not.toBeNull();
    metrics.recordSuccess();
    expect(metrics.snapshot()).toMatchObject({ status: 'ok', sent: 2, failed: 1 });
  });

  it('reports timestamps as ISO strings without leaking recipients', () => {
    const metrics = new MailMetrics();
    metrics.recordFailure();
    const snapshot = metrics.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      'failed',
      'lastFailureAt',
      'lastSuccessAt',
      'sent',
      'status',
    ]);
    expect(snapshot.lastFailureAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
