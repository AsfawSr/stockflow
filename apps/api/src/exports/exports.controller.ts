import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { ExportsService } from './exports.service';

@Controller('organizations/:organizationId/export')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
@Roles('ADMIN')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  export(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    return this.exports.exportOrganization(request.principal.user.id, organizationId);
  }
}
