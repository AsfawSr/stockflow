import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { PageQueryDto } from '../common/list-query.dto';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { ReportsService } from './reports.service';

@Controller('organizations/:organizationId/reports')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('valuation/snapshots')
  @Roles('ADMIN', 'MANAGER')
  @Header('Cache-Control', 'no-store')
  create(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    return this.reports.createValuationSnapshot(request.principal.user.id, organizationId);
  }

  @Get('valuation/snapshots')
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: PageQueryDto) {
    return this.reports.listValuationSnapshots(organizationId, query);
  }

  @Get('valuation/snapshots/:snapshotId')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('organizationId') organizationId: string,
    @Param('snapshotId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) snapshotId: string,
  ) {
    return this.reports.getValuationSnapshot(organizationId, snapshotId);
  }
}
