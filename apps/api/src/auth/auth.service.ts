import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { PasswordService } from './password.service';

const profileSelect = { id: true, email: true, displayName: true } as const;

export type AuthPrincipal = {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
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
      return { user, accessToken: session.accessToken, expiresAt: session.expiresAt };
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
      select: { ...profileSelect, credential: { select: { passwordHash: true } } },
    });
    const valid = await this.passwords.matches(input.password, account?.credential?.passwordHash);
    if (!account?.credential || !valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const session = this.newSession();
    await this.prisma.session.create({
      data: { userId: account.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt },
    });
    return {
      user: { id: account.id, email: account.email, displayName: account.displayName },
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
    };
  }

  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: { id: true, expiresAt: true, user: { select: profileSelect } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Authentication required.');
    }
    return { sessionId: session.id, user: session.user };
  }

  async logout(principal: AuthPrincipal): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { id: principal.sessionId, userId: principal.user.id },
    });
  }
}
