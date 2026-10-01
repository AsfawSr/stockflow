import { ConfigService } from '@nestjs/config';
import { CleanupService } from '../src/maintenance/cleanup.service';
import { PrismaService } from '../src/prisma/prisma.service';

type DeleteManyMock = jest.Mock<Promise<{ count: number }>, [unknown]>;

function buildPrisma(counts: {
  sessions: number;
  tokens: number;
  invitations: number;
  rateLimits: number;
}) {
  return {
    session: { deleteMany: jest.fn().mockResolvedValue({ count: counts.sessions }) },
    accountToken: { deleteMany: jest.fn().mockResolvedValue({ count: counts.tokens }) },
    invitation: { deleteMany: jest.fn().mockResolvedValue({ count: counts.invitations }) },
    rateLimit: { deleteMany: jest.fn().mockResolvedValue({ count: counts.rateLimits }) },
  } as unknown as PrismaService & {
    session: { deleteMany: DeleteManyMock };
    accountToken: { deleteMany: DeleteManyMock };
    invitation: { deleteMany: DeleteManyMock };
    rateLimit: { deleteMany: DeleteManyMock };
  };
}

describe('CleanupService', () => {
  it('deletes only expired sessions, account tokens, invitations, and rate limits', async () => {
    const prisma = buildPrisma({ sessions: 2, tokens: 1, invitations: 3, rateLimits: 4 });
    const service = new CleanupService(prisma, new ConfigService({ NODE_ENV: 'test' }));
    const before = new Date();
    const result = await service.sweep();
    expect(result).toEqual({ sessions: 2, tokens: 1, invitations: 3, rateLimits: 4 });
    for (const model of [
      prisma.session,
      prisma.accountToken,
      prisma.invitation,
      prisma.rateLimit,
    ]) {
      expect(model.deleteMany).toHaveBeenCalledTimes(1);
      const argument = model.deleteMany.mock.calls[0][0] as {
        where: { expiresAt: { lte: Date } };
      };
      expect(argument.where.expiresAt.lte).toBeInstanceOf(Date);
      expect(argument.where.expiresAt.lte.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(Object.keys(argument.where)).toEqual(['expiresAt']);
    }
  });

  it('does not schedule sweeps in the test environment and never throws on failure', async () => {
    const prisma = buildPrisma({ sessions: 0, tokens: 0, invitations: 0, rateLimits: 0 });
    prisma.session.deleteMany.mockRejectedValue(new Error('database offline'));
    const service = new CleanupService(prisma, new ConfigService({ NODE_ENV: 'test' }));
    service.onModuleInit();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    await expect(service.sweep()).resolves.toBeNull();
    service.onModuleDestroy();
  });

  it('schedules an immediate sweep outside tests and stops on shutdown', async () => {
    jest.useFakeTimers();
    try {
      const prisma = buildPrisma({ sessions: 0, tokens: 0, invitations: 0, rateLimits: 0 });
      const service = new CleanupService(
        prisma,
        new ConfigService({ NODE_ENV: 'production', CLEANUP_INTERVAL_MS: '1000' }),
      );
      service.onModuleInit();
      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(2000);
      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(3);
      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(5000);
      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
