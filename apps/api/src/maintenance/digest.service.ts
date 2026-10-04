import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountMailer } from '../auth/account-mailer.service';
import { PrismaService } from '../prisma/prisma.service';

const HOUR_MS = 60 * 60 * 1000;
// Under a day so the digest drifts earlier rather than skipping a day outright.
const RESEND_AFTER_MS = 20 * HOUR_MS;

@Injectable()
export class DigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AccountMailer,
    config: ConfigService,
  ) {
    this.enabled = config.get('NODE_ENV') !== 'test';
    const configured = Number(config.get('DIGEST_INTERVAL_MS') ?? HOUR_MS);
    this.intervalMs = Number.isInteger(configured) && configured >= 1000 ? configured : HOUR_MS;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    // The timer must never keep a stopping process alive.
    this.timer.unref?.();
    void this.sweep();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep() {
    try {
      const cutoff = new Date(Date.now() - RESEND_AFTER_MS);
      const organizations = await this.prisma.organization.findMany({
        where: {
          replyToEmail: { not: null },
          archivedAt: null,
          OR: [{ lastDigestAt: null }, { lastDigestAt: { lte: cutoff } }],
        },
        select: { id: true, name: true, replyToEmail: true },
      });
      let sent = 0;
      for (const organization of organizations) {
        if (await this.notify(organization, cutoff)) sent += 1;
      }
      if (sent > 0) this.logger.log(`Sent ${sent} low-stock digest${sent === 1 ? '' : 's'}.`);
      return sent;
    } catch {
      this.logger.warn('Low-stock digest sweep failed; it will retry on the next interval.');
      return null;
    }
  }

  private async notify(
    organization: { id: string; name: string; replyToEmail: string | null },
    cutoff: Date,
  ): Promise<boolean> {
    const rows = (await this.prisma.$queryRaw`
      SELECT p.name, p.sku, p.unit, p.reorder_point,
        COALESCE(SUM(l.quantity), 0)::int AS on_hand
      FROM products p
      LEFT JOIN stock_levels l
        ON l.organization_id = p.organization_id AND l.product_id = p.id
      WHERE p.organization_id = ${organization.id}::uuid
        AND p.archived_at IS NULL AND p.reorder_point IS NOT NULL
      GROUP BY p.id
      HAVING COALESCE(SUM(l.quantity), 0) <= p.reorder_point
      ORDER BY p.name ASC
    `) as { name: string; sku: string; unit: string; reorder_point: number; on_hand: number }[];
    if (rows.length === 0) return false;
    // Claim the window before sending so parallel instances never double-send.
    const claimed = await this.prisma.organization.updateMany({
      where: {
        id: organization.id,
        OR: [{ lastDigestAt: null }, { lastDigestAt: { lte: cutoff } }],
      },
      data: { lastDigestAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    const lines = rows
      .map(
        (row) =>
          `- ${row.name} (${row.sku}): ${row.on_hand} ${row.unit} on hand, reorder at ${row.reorder_point}`,
      )
      .join('\n');
    try {
      await this.mailer.send({
        to: organization.replyToEmail!,
        subject: `Low stock digest: ${rows.length} ${rows.length === 1 ? 'product needs' : 'products need'} attention`,
        text: `Hello ${organization.name} team,\n\nThese products are at or below their reorder points:\n\n${lines}\n\nReview and reorder: ${this.mailer.webOrigin}/workspace/${organization.id}/stock?show=low`,
      });
      return true;
    } catch {
      this.logger.warn(`Low-stock digest for ${organization.id} failed to send.`);
      return false;
    }
  }
}
