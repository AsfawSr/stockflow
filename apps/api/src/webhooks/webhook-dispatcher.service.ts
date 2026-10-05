import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type WebhookOrderEvent = {
  id: string;
  reference: string;
  status: string;
  total: string;
};

export type WebhookSendOutcome = {
  ok: boolean;
  responseStatus: number | null;
  error: string | null;
};

// One initial attempt plus four retries, backing off from one minute to an hour.
export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];

export function nextRetryDelayMs(attempts: number): number {
  return WEBHOOK_RETRY_DELAYS_MS[Math.min(attempts - 1, WEBHOOK_RETRY_DELAYS_MS.length - 1)];
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(private readonly prisma: PrismaService) {}

  // Best effort: a failed delivery never rolls back the order change it describes.
  async dispatch(organizationId: string, event: string, order: WebhookOrderEvent): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId, active: true },
      select: { id: true, url: true, secret: true },
    });
    if (endpoints.length === 0) return;
    const body = JSON.stringify({
      event,
      organizationId,
      order: { id: order.id, reference: order.reference, status: order.status, total: order.total },
      occurredAt: new Date().toISOString(),
    });
    await Promise.all(
      endpoints.map((endpoint) => this.deliverWithLog(organizationId, endpoint, event, body)),
    );
  }

  async send(
    url: string,
    secret: string,
    event: string,
    body: string,
  ): Promise<WebhookSendOutcome> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-StockFlow-Event': event,
          'X-StockFlow-Signature': signWebhookBody(secret, body),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.warn(`Webhook ${url} answered ${response.status} for ${event}.`);
        return { ok: false, responseStatus: response.status, error: `HTTP ${response.status}` };
      }
      return { ok: true, responseStatus: response.status, error: null };
    } catch (error) {
      this.logger.warn(`Webhook delivery to ${url} failed for ${event}.`);
      const message = error instanceof Error ? error.message : 'Delivery failed.';
      return { ok: false, responseStatus: null, error: message.slice(0, 400) };
    }
  }

  private async deliverWithLog(
    organizationId: string,
    endpoint: { id: string; url: string; secret: string },
    event: string,
    body: string,
  ): Promise<void> {
    let deliveryId: string | null = null;
    try {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          webhookEndpointId: endpoint.id,
          organizationId,
          event,
          body,
          nextAttemptAt: new Date(),
        },
        select: { id: true },
      });
      deliveryId = delivery.id;
    } catch {
      this.logger.warn(`Webhook delivery bookkeeping failed for ${event}.`);
    }
    const outcome = await this.send(endpoint.url, endpoint.secret, event, body);
    if (!deliveryId) return;
    try {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: outcome.ok
          ? {
              status: 'SUCCEEDED',
              attempts: 1,
              responseStatus: outcome.responseStatus,
              lastError: null,
              nextAttemptAt: null,
            }
          : {
              status: 'PENDING',
              attempts: 1,
              responseStatus: outcome.responseStatus,
              lastError: outcome.error,
              nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(1)),
            },
      });
    } catch {
      this.logger.warn(`Webhook delivery bookkeeping failed for ${event}.`);
    }
  }
}
