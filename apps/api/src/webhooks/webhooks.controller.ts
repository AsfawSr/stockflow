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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { CreateWebhookDto, UpdateWebhookDto } from './webhooks.dto';
import { WebhooksService } from './webhooks.service';

@Controller('organizations/:organizationId/webhooks')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
@Roles('ADMIN')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string) {
    return this.webhooks.list(organizationId);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: CreateWebhookDto,
  ) {
    return this.webhooks.create(request.principal.user.id, organizationId, input.url);
  }

  @Patch(':webhookId')
  @Header('Cache-Control', 'no-store')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('webhookId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) webhookId: string,
    @Body() input: UpdateWebhookDto,
  ) {
    return this.webhooks.update(request.principal.user.id, organizationId, webhookId, input.active);
  }

  @Delete(':webhookId')
  @HttpCode(204)
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('webhookId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) webhookId: string,
  ) {
    return this.webhooks.remove(request.principal.user.id, organizationId, webhookId);
  }
}
