import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  InvitationAcceptController,
  OrganizationInvitationsController,
} from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [PrismaModule, OrganizationsModule, AuthModule],
  controllers: [OrganizationInvitationsController, InvitationAcceptController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
