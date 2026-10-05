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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { PageQueryDto } from '../common/list-query.dto';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { OpenCycleCountDto, RecordCountDto } from './cycle-counts.dto';
import { CycleCountsService } from './cycle-counts.service';

@Controller('organizations/:organizationId/cycle-counts')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class CycleCountsController {
  constructor(private readonly counts: CycleCountsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: PageQueryDto) {
    return this.counts.list(organizationId, query);
  }

  @Get(':countId')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('organizationId') organizationId: string,
    @Param('countId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) countId: string,
  ) {
    return this.counts.get(organizationId, countId);
  }

  @Post()
  @Roles('ADMIN', 'WAREHOUSE')
  @Header('Cache-Control', 'no-store')
  open(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: OpenCycleCountDto,
  ) {
    return this.counts.open(request.principal.user.id, organizationId, input);
  }

  @Put(':countId/lines/:productId')
  @Roles('ADMIN', 'WAREHOUSE')
  @Header('Cache-Control', 'no-store')
  recordLine(
    @Param('organizationId') organizationId: string,
    @Param('countId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) countId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
    @Body() input: RecordCountDto,
  ) {
    return this.counts.recordLine(organizationId, countId, productId, input.countedQuantity);
  }

  @Delete(':countId/lines/:productId')
  @Roles('ADMIN', 'WAREHOUSE')
  @HttpCode(204)
  removeLine(
    @Param('organizationId') organizationId: string,
    @Param('countId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) countId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
  ) {
    return this.counts.removeLine(organizationId, countId, productId);
  }

  @Post(':countId/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('countId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) countId: string,
  ) {
    return this.counts.cancel(request.principal.user.id, organizationId, countId);
  }

  @Post(':countId/complete')
  @Roles('ADMIN', 'WAREHOUSE')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  complete(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('countId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) countId: string,
  ) {
    return this.counts.complete(request.principal.user.id, organizationId, countId);
  }
}
