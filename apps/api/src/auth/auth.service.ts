import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { PasswordService } from './password.service';
import { AccountService } from './account.service';

const profileSelect = { id: true, email: true, displayName: true, emailVerifiedAt: true } as const;

export type AuthPrincipal = {
  sessionId: string;
  user: { id: string; email: string; displayName: string; emailVerifiedAt: Date | null };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly accounts: AccountService,
  ) {}

  private newSession() {
    const accessToken = randomBytes(32).toString('base64url');
    return {
      accessToken,
      tokenHash: createHash('sha256').update(accessToken).digest('hex'),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    };
  }

  async register(input: RegisterDto) {
    const passwordHash = await this.passwords.hash(input.password);
    const session = this.newSession();
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          credential: { create: { passwordHash } },
          sessions: { create: { tokenHash: session.tokenHash, expiresAt: session.expiresAt } },
        },
        select: profileSelect,
      });
      const verificationEmailSent = await this.accounts.sendVerification(user.id);
      return {
        user,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        verificationEmailSent,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account could not be created with these details.');
      }
      throw error;
    }
  }

  async login(input: LoginDto) {
    const account = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        ...profileSelect,
        authVersion: true,
        credential: { select: { passwordHash: true } },
      },
    });
    const valid = await this.passwords.matches(input.password, account?.credential?.passwordHash);
    if (!account?.credential || !valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const session = this.newSession();
    await this.prisma.session.create({
      data: {
        userId: account.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        authVersion: account.authVersion,
      },
    });
    return {
      user: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        emailVerifiedAt: account.emailVerifiedAt,
      },
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
    };
  }

  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        authVersion: true,
        user: { select: { ...profileSelect, authVersion: true } },
      },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      session.authVersion !== session.user.authVersion
    ) {
      throw new UnauthorizedException('Authentication required.');
    }
    const { authVersion: _version, ...user } = session.user;
    return { sessionId: session.id, user };
  }

  async changePassword(principal: AuthPrincipal, input: ChangePasswordDto): Promise<void> {
    const account = await this.prisma.user.findUnique({
      where: { id: principal.user.id },
      select: { authVersion: true, credential: { select: { passwordHash: true } } },
    });
    const valid = await this.passwords.matches(
      input.currentPassword,
      account?.credential?.passwordHash,
    );
    if (!account?.credential || !valid)
      throw new BadRequestException('Your current password is incorrect.');
    const passwordHash = await this.passwords.hash(input.newPassword);
    const stale = () => new UnauthorizedException('Authentication required.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${principal.user.id}::uuid FOR UPDATE`;
      const updated = await tx.user.updateMany({
        where: { id: principal.user.id, authVersion: account.authVersion },
        data: { authVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw stale();
      await tx.passwordCredential.update({
        where: { userId: principal.user.id },
        data: { passwordHash },
      });
      // Only the session that proved the current password survives the version bump.
      await tx.session.deleteMany({
        where: { userId: principal.user.id, id: { not: principal.sessionId } },
      });
      const kept = await tx.session.updateMany({
        where: { id: principal.sessionId, userId: principal.user.id },
        data: { authVersion: account.authVersion + 1 },
      });
      if (kept.count !== 1) throw stale();
      await tx.accountToken.deleteMany({ where: { userId: principal.user.id } });
    });
  }

  async logout(principal: AuthPrincipal): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { id: principal.sessionId, userId: principal.user.id },
    });
  }
}
