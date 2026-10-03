import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
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
import { AcceptInvitationDto, CreateInvitationDto } from './invitations.dto';
import { InvitationsService } from './invitations.service';

@Controller('organizations/:organizationId/invitations')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
@Roles('ADMIN')
export class OrganizationInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: PageQueryDto) {
    return this.invitations.list(organizationId, query);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: CreateInvitationDto,
  ) {
    return this.invitations.create(organizationId, request.principal.user.id, input);
  }

  @Delete(':invitationId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('invitationId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) invitationId: string,
  ) {
    return this.invitations.revoke(organizationId, request.principal.user.id, invitationId);
  }
}

@Controller('invitations')
@UseGuards(VerifiedEmailGuard)
export class InvitationAcceptController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  accept(@Req() request: AuthenticatedRequest, @Body() input: AcceptInvitationDto) {
    return this.invitations.accept(request.principal.user, input.token);
  }
}
