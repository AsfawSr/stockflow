import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class CleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get('NODE_ENV') !== 'test';
    const configured = Number(config.get('CLEANUP_INTERVAL_MS') ?? HOUR_MS);
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
      const now = new Date();
      const sessions = await this.prisma.session.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      const tokens = await this.prisma.accountToken.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      const invitations = await this.prisma.invitation.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      const removed = sessions.count + tokens.count + invitations.count;
      if (removed > 0) {
        this.logger.log(
          `Removed ${sessions.count} expired sessions, ${tokens.count} account tokens, and ${invitations.count} invitations.`,
        );
      }
      return { sessions: sessions.count, tokens: tokens.count, invitations: invitations.count };
    } catch {
      this.logger.warn('Expired record cleanup failed; it will retry on the next interval.');
      return null;
    }
  }
}
