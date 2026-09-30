import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AccountTokenPurpose } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountMailer } from './account-mailer.service';
import { PasswordService } from './password.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mailer: AccountMailer,
  ) {}

  async sendVerification(userId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, authVersion: true, emailVerifiedAt: true },
      });
      if (!user) return false;
      if (user.emailVerifiedAt) return true;
      return await this.issue(user, 'VERIFY_EMAIL');
    } catch {
      this.logger.warn('Verification email could not be prepared.');
      return false;
    }
  }

  async requestReset(email: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          authVersion: true,
          credential: { select: { userId: true } },
        },
      });
      if (user?.credential) await this.issue(user, 'RESET_PASSWORD');
    } catch {
      this.logger.warn('Password reset email could not be prepared.');
    }
  }

  private async issue(
    user: { id: string; email: string; authVersion: number },
    purpose: AccountTokenPurpose,
  ): Promise<boolean> {
    const token = randomBytes(32).toString('base64url');
    const verification = purpose === 'VERIFY_EMAIL';
    const created = await this.prisma.accountToken.create({
      data: {
        userId: user.id,
        email: user.email,
        authVersion: user.authVersion,
        purpose,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + (verification ? 24 * 60 : 30) * 60000),
      },
    });
    const link = new URL(
      verification ? '/verify-email/confirm' : '/reset-password',
      this.mailer.webOrigin,
    );
    link.hash = new URLSearchParams({ token }).toString();
    try {
      await this.mailer.send({
        to: user.email,
        subject: verification ? 'Verify your StockFlow email' : 'Reset your StockFlow password',
        text: `${verification ? 'Verify your email' : 'Reset your password'}: ${link.href}\n\nThis link expires in ${verification ? '24 hours' : '30 minutes'} and works once. If you did not request it, ignore this email.`,
        actionUrl: link.href,
      });
      return true;
    } catch {
      await this.prisma.accountToken.deleteMany({ where: { id: created.id } });
      this.logger.warn('Account email delivery failed.');
      return false;
    }
  }

  verifyEmail(token: string) {
    return this.consume(token, 'VERIFY_EMAIL');
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await this.passwords.hash(password);
    await this.consume(token, 'RESET_PASSWORD', passwordHash);
  }

  private async consume(
    token: string,
    purpose: AccountTokenPurpose,
    passwordHash?: string,
  ): Promise<void> {
    const invalid = () =>
      new BadRequestException('This link is invalid or expired. Request a new link.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.$transaction(async (database) => {
      const candidate = await database.accountToken.findUnique({
        where: { tokenHash },
        include: { user: { select: { email: true, authVersion: true, emailVerifiedAt: true } } },
      });
      const now = new Date();
      if (
        !candidate ||
        candidate.purpose !== purpose ||
        candidate.consumedAt ||
        candidate.expiresAt <= now ||
        candidate.email !== candidate.user.email ||
        candidate.authVersion !== candidate.user.authVersion
      )
        throw invalid();
      await database.$queryRaw`SELECT id FROM users WHERE id = ${candidate.userId}::uuid FOR UPDATE`;
      const claimed = await database.accountToken.updateMany({
        where: { id: candidate.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) throw invalid();
      const resetting = purpose === 'RESET_PASSWORD';
      const updated = await database.user.updateMany({
        where: {
          id: candidate.userId,
          email: candidate.email,
          authVersion: candidate.authVersion,
          ...(resetting ? { credential: { isNot: null } } : {}),
        },
        data: {
          emailVerifiedAt: candidate.user.emailVerifiedAt ?? now,
          ...(resetting ? { authVersion: { increment: 1 } } : {}),
        },
      });
      if (updated.count !== 1) throw invalid();
      if (resetting) {
        await database.passwordCredential.update({
          where: { userId: candidate.userId },
          data: { passwordHash: passwordHash! },
        });
        await database.session.deleteMany({ where: { userId: candidate.userId } });
        await database.accountToken.deleteMany({ where: { userId: candidate.userId } });
      } else {
        await database.accountToken.updateMany({
          where: { userId: candidate.userId, purpose: 'VERIFY_EMAIL', consumedAt: null },
          data: { consumedAt: now },
        });
      }
    });
  }
}
