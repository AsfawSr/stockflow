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
import { VerifiedEmailGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import {
  CreatePurchaseOrderDto,
  CreateReceiptDto,
  DecisionDto,
  ListPurchaseOrdersDto,
  OrderLineDto,
  RejectDto,
  UpdateOrderLineDto,
  UpdatePurchaseOrderDto,
} from './purchase-orders.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

const orderIdParam = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('organizations/:organizationId/purchase-orders')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: ListPurchaseOrdersDto) {
    return this.orders.list(organizationId, query);
  }

  // Must stay above the :orderId route so 'suggestions' is not parsed as an id.
  @Get('suggestions')
  @Header('Cache-Control', 'no-store')
  suggestions(@Param('organizationId') organizationId: string) {
    return this.orders.suggestions(organizationId);
  }

  @Get(':orderId')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
  ) {
    return this.orders.get(organizationId, orderId);
  }

  @Post()
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: CreatePurchaseOrderDto,
  ) {
    return this.orders.create(organizationId, request.principal.user.id, input);
  }

  @Patch(':orderId')
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Body() input: UpdatePurchaseOrderDto,
  ) {
    return this.orders.update(organizationId, orderId, input);
  }

  @Post(':orderId/lines')
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  addLine(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Body() input: OrderLineDto,
  ) {
    return this.orders.addLine(organizationId, orderId, input);
  }

  @Patch(':orderId/lines/:lineId')
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  updateLine(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Param('lineId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) lineId: string,
    @Body() input: UpdateOrderLineDto,
  ) {
    return this.orders.updateLine(organizationId, orderId, lineId, input);
  }

  @Delete(':orderId/lines/:lineId')
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  removeLine(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Param('lineId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) lineId: string,
  ) {
    return this.orders.removeLine(organizationId, orderId, lineId);
  }

  @Post(':orderId/submit')
  @Roles('ADMIN', 'PURCHASER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
  ) {
    return this.orders.submit(organizationId, orderId);
  }

  @Post(':orderId/approve')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Body() input: DecisionDto,
  ) {
    return this.orders.decide(
      organizationId,
      orderId,
      request.principal.user.id,
      true,
      input.note ?? null,
    );
  }

  @Post(':orderId/reject')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reject(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Body() input: RejectDto,
  ) {
    return this.orders.decide(
      organizationId,
      orderId,
      request.principal.user.id,
      false,
      input.note,
    );
  }

  @Post(':orderId/cancel')
  @Roles('ADMIN', 'PURCHASER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
  ) {
    return this.orders.cancel(organizationId, orderId);
  }

  @Post(':orderId/receipts')
  @Roles('ADMIN', 'WAREHOUSE')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  receive(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('orderId', orderIdParam) orderId: string,
    @Body() input: CreateReceiptDto,
  ) {
    return this.orders.receive(organizationId, orderId, request.principal.user.id, input);
  }
}
