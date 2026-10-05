import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CycleCountsController } from './cycle-counts.controller';
import { CycleCountsService } from './cycle-counts.service';

@Module({
  imports: [PrismaModule, AuditModule, OrganizationsModule],
  controllers: [CycleCountsController],
  providers: [CycleCountsService],
})
export class CycleCountsModule {}
