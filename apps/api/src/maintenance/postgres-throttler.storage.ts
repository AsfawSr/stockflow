import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { PrismaService } from '../prisma/prisma.service';

// Fixed-window counter shared by every API process through PostgreSQL.
@Injectable()
export class PostgresThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const storageKey = `${throttlerName}:${key}`.slice(0, 128);
    const rows = (await this.prisma.$queryRaw`
      INSERT INTO rate_limits (key, hits, expires_at)
      VALUES (${storageKey}, 1, now() + make_interval(secs => ${ttl}::double precision / 1000))
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN rate_limits.expires_at <= now() THEN 1
          ELSE rate_limits.hits + 1
        END,
        expires_at = CASE
          WHEN rate_limits.expires_at <= now() THEN EXCLUDED.expires_at
          ELSE rate_limits.expires_at
        END
      RETURNING hits, GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (expires_at - now())))::int
      ) AS seconds_remaining
    `) as { hits: number; seconds_remaining: number }[];
    const { hits, seconds_remaining: secondsRemaining } = rows[0];
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire: secondsRemaining,
      isBlocked,
      timeToBlockExpire: isBlocked ? secondsRemaining : 0,
    };
  }
}
