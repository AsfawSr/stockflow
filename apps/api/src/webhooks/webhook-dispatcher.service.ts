import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type WebhookOrderEvent = {
  id: string;
  reference: string;
  status: string;
  total: string;
};

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(private readonly prisma: PrismaService) {}

  // Best effort: a failed delivery never rolls back the order change it describes.
  async dispatch(organizationId: string, event: string, order: WebhookOrderEvent): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId, active: true },
      select: { url: true, secret: true },
    });
    if (endpoints.length === 0) return;
    const body = JSON.stringify({
      event,
      organizationId,
      order: { id: order.id, reference: order.reference, status: order.status, total: order.total },
      occurredAt: new Date().toISOString(),
    });
    await Promise.all(
      endpoints.map(async (endpoint) => {
        try {
          const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');
          const response = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-StockFlow-Event': event,
              'X-StockFlow-Signature': `sha256=${signature}`,
            },
            body,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) {
            this.logger.warn(`Webhook ${endpoint.url} answered ${response.status} for ${event}.`);
          }
        } catch {
          this.logger.warn(`Webhook delivery to ${endpoint.url} failed for ${event}.`);
        }
      }),
    );
  }
}
