import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationAccessGuard } from './organization-access.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationAccessGuard],
  exports: [OrganizationAccessGuard],
})
export class OrganizationsModule {}
