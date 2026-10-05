import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WebhookDispatcher,
  nextRetryDelayMs,
} from './webhook-dispatcher.service';

const MINUTE_MS = 60 * 1000;
// Skips first attempts that are still in flight on another instance.
const CLAIM_GRACE_MS = 30 * 1000;

@Injectable()
export class WebhookRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: WebhookDispatcher,
    config: ConfigService,
  ) {
    this.enabled = config.get('NODE_ENV') !== 'test';
    const configured = Number(config.get('WEBHOOK_RETRY_INTERVAL_MS') ?? MINUTE_MS);
    this.intervalMs = Number.isInteger(configured) && configured >= 1000 ? configured : MINUTE_MS;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    // The timer must never keep a stopping process alive.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number | null> {
    try {
      const cutoff = new Date(Date.now() - CLAIM_GRACE_MS);
      // Retries pause while an endpoint is disabled; deleting it cascades the queue away.
      const candidates = await this.prisma.webhookDelivery.findMany({
        where: {
          status: 'PENDING',
          nextAttemptAt: { lte: cutoff },
          endpoint: { active: true },
        },
        select: {
          id: true,
          attempts: true,
          event: true,
          body: true,
          endpoint: { select: { url: true, secret: true } },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: 20,
      });
      let retried = 0;
      for (const delivery of candidates) {
        const attempts = delivery.attempts + 1;
        // Claim the row before sending so parallel instances never double-send.
        const claimed = await this.prisma.webhookDelivery.updateMany({
          where: { id: delivery.id, status: 'PENDING', nextAttemptAt: { lte: cutoff } },
          data: { attempts, nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(attempts)) },
        });
        if (claimed.count !== 1) continue;
        const outcome = await this.dispatcher.send(
          delivery.endpoint.url,
          delivery.endpoint.secret,
          delivery.event,
          delivery.body,
        );
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: outcome.ok
            ? {
                status: 'SUCCEEDED',
                responseStatus: outcome.responseStatus,
                lastError: null,
                nextAttemptAt: null,
              }
            : attempts >= WEBHOOK_MAX_ATTEMPTS
              ? {
                  status: 'FAILED',
                  responseStatus: outcome.responseStatus,
                  lastError: outcome.error,
                  nextAttemptAt: null,
                }
              : { responseStatus: outcome.responseStatus, lastError: outcome.error },
        });
        retried += 1;
      }
      if (retried > 0) {
        this.logger.log(`Retried ${retried} webhook deliver${retried === 1 ? 'y' : 'ies'}.`);
      }
      return retried;
    } catch {
      this.logger.warn('Webhook retry sweep failed; it will retry on the next interval.');
      return null;
    }
  }
}
