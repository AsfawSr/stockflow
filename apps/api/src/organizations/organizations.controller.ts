import { Body, Controller, Get, Header, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { OrganizationAccessGuard, Roles } from './organization-access.guard';
import { CreateOrganizationDto, RenameOrganizationDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest) {
    return this.organizations.list(request.principal.user.id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateOrganizationDto) {
    return this.organizations.create(request.principal.user.id, input);
  }

  @Get(':organizationId')
  @UseGuards(OrganizationAccessGuard)
  @Header('Cache-Control', 'no-store')
  get(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    return this.organizations.get(request.principal.user.id, organizationId);
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationAccessGuard)
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  rename(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: RenameOrganizationDto,
  ) {
    return this.organizations.rename(request.principal.user.id, organizationId, input);
  }

  @Get(':organizationId/members')
  @UseGuards(OrganizationAccessGuard)
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  members(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    return this.organizations.members(request.principal.user.id, organizationId);
  }
}
