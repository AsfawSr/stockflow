import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AccountMailer } from '../auth/account-mailer.service';
import { AuditService } from '../audit/audit.service';
import { PageQueryDto } from '../common/list-query.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvitationDto } from './invitations.dto';

const invitationSelect = {
  id: true,
  email: true,
  roles: true,
  createdAt: true,
  expiresAt: true,
  invitedBy: { select: { id: true, displayName: true } },
} as const;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AccountMailer,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { organizationId, expiresAt: { gt: new Date() } };
    const [items, total] = await Promise.all([
      this.prisma.invitation.findMany({
        where,
        select: invitationSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invitation.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(organizationId: string, userId: string, input: CreateInvitationDto) {
    const member = await this.prisma.membership.findFirst({
      where: { organizationId, user: { email: input.email } },
      select: { id: true },
    });
    if (member) throw new ConflictException('This person is already a member.');
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    const token = randomBytes(32).toString('base64url');
    // Re-inviting the same address replaces the previous link.
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.deleteMany({ where: { organizationId, email: input.email } });
      return tx.invitation.create({
        data: {
          organizationId,
          email: input.email,
          roles: input.roles,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          invitedById: userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60000),
        },
        select: invitationSelect,
      });
    });
    const link = new URL('/invitations/accept', this.mailer.webOrigin);
    link.hash = new URLSearchParams({ token }).toString();
    try {
      await this.mailer.send({
        to: input.email,
        subject: `You are invited to ${organization.name} on StockFlow`,
        text: `Join ${organization.name} on StockFlow: ${link.href}\n\nSign in or create an account with this email address, then open the link. It expires in 7 days and works once. If you did not expect this invitation, ignore this email.`,
        actionUrl: link.href,
      });
    } catch {
      await this.prisma.invitation.deleteMany({ where: { id: invitation.id } });
      this.logger.warn('Invitation email delivery failed.');
      throw new ServiceUnavailableException('The invitation email could not be sent. Try again.');
    }
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: invitation.id,
      summary: `Invited ${input.email} as ${input.roles.join(', ')}`,
    });
    return invitation;
  }

  async revoke(organizationId: string, actorId: string, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
      select: { email: true },
    });
    const removed = await this.prisma.invitation.deleteMany({
      where: { id: invitationId, organizationId },
    });
    if (removed.count !== 1 || !invitation) throw new NotFoundException('Invitation not found.');
    await this.audit.record({
      organizationId,
      actorId,
      action: 'invitation.revoked',
      entityType: 'invitation',
      entityId: invitationId,
      summary: `Revoked the invitation for ${invitation.email}`,
    });
  }

  async accept(user: { id: string; email: string }, token: string) {
    const invalid = () =>
      new BadRequestException('This invitation is invalid or expired. Ask for a new one.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const joined = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.invitation.findUnique({
        where: { tokenHash },
        select: { id: true, organizationId: true, email: true, roles: true, expiresAt: true },
      });
      if (!candidate || candidate.expiresAt <= new Date()) throw invalid();
      if (candidate.email !== user.email)
        throw new ForbiddenException('This invitation was issued for a different email address.');
      const claimed = await tx.invitation.deleteMany({
        where: { id: candidate.id, expiresAt: { gt: new Date() } },
      });
      if (claimed.count !== 1) throw invalid();
      try {
        const membership = await tx.membership.create({
          data: {
            organizationId: candidate.organizationId,
            userId: user.id,
            roles: candidate.roles,
          },
          select: {
            roles: true,
            organization: {
              select: { id: true, name: true, currency: true, createdAt: true, updatedAt: true },
            },
          },
        });
        return { ...membership.organization, roles: membership.roles };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('You are already a member of this organization.');
        }
        throw error;
      }
    });
    await this.audit.record({
      organizationId: joined.id,
      actorId: user.id,
      action: 'invitation.accepted',
      entityType: 'invitation',
      summary: `${user.email} joined from an invitation`,
    });
    return joined;
  }
}
