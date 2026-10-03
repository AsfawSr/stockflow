import { Module } from '@nestjs/common';
import { OrganizationAccessGuard } from '../organizations/organization-access.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// Provides the access guard itself to stay importable by OrganizationsModule without a cycle.
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService, OrganizationAccessGuard],
  exports: [AuditService],
})
export class AuditModule {}
