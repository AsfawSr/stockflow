import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export const EXPORT_FORMAT = 'stockflow-export';
export const EXPORT_VERSION = 1;

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // One self-describing document; sections are appended by later milestone commits.
  async exportOrganization(actorId: string, organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        currency: true,
        replyToEmail: true,
        archivedAt: true,
        createdAt: true,
      },
    });
    const document = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date(),
      organization,
    };
    await this.audit.record({
      organizationId,
      actorId,
      action: 'organization.exported',
      entityType: 'organization',
      entityId: organizationId,
      summary: `Exported the organization's data`,
    });
    return document;
  }
}
