import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { PageQueryDto } from '../common/list-query.dto';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { AuditService } from './audit.service';

@Controller('organizations/:organizationId/audit')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: PageQueryDto) {
    return this.audit.list(organizationId, query);
  }
}
