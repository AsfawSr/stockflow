import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { PageQueryDto } from '../common/list-query.dto';
import { OrganizationAccessGuard, Roles } from './organization-access.guard';
import {
  CreateOrganizationDto,
  RenameOrganizationDto,
  UpdateMemberRolesDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
@UseGuards(VerifiedEmailGuard)
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
  members(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.organizations.members(request.principal.user.id, organizationId, query);
  }

  @Patch(':organizationId/members/:memberUserId')
  @UseGuards(OrganizationAccessGuard)
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  updateMemberRoles(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('memberUserId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) memberUserId: string,
    @Body() input: UpdateMemberRolesDto,
  ) {
    return this.organizations.updateMemberRoles(
      organizationId,
      request.principal.user.id,
      memberUserId,
      input,
    );
  }

  @Delete(':organizationId/members/:memberUserId')
  @UseGuards(OrganizationAccessGuard)
  @Roles('ADMIN')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('memberUserId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) memberUserId: string,
  ) {
    return this.organizations.removeMember(organizationId, request.principal.user.id, memberUserId);
  }
}
