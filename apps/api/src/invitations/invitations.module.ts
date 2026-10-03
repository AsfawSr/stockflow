import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  InvitationAcceptController,
  OrganizationInvitationsController,
} from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [PrismaModule, OrganizationsModule, AuthModule, AuditModule],
  controllers: [OrganizationInvitationsController, InvitationAcceptController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
