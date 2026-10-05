import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { ListQueryDto } from '../common/list-query.dto';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { CreateSupplierDto, SetCatalogPriceDto, UpdateSupplierDto } from './suppliers.dto';
import { SuppliersService } from './suppliers.service';

@Controller('organizations/:organizationId/suppliers')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: ListQueryDto) {
    return this.suppliers.list(organizationId, query);
  }

  @Get(':supplierId')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
  ) {
    return this.suppliers.get(organizationId, supplierId);
  }

  @Get(':supplierId/prices')
  @Header('Cache-Control', 'no-store')
  prices(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
  ) {
    return this.suppliers.prices(organizationId, supplierId);
  }

  @Get(':supplierId/catalog')
  @Header('Cache-Control', 'no-store')
  catalog(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
  ) {
    return this.suppliers.catalog(organizationId, supplierId);
  }

  @Put(':supplierId/catalog/:productId')
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  setCatalogPrice(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
    @Body() input: SetCatalogPriceDto,
  ) {
    return this.suppliers.setCatalogPrice(
      request.principal.user.id,
      organizationId,
      supplierId,
      productId,
      input.unitPrice,
    );
  }

  @Get(':supplierId/performance')
  @Header('Cache-Control', 'no-store')
  performance(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
  ) {
    return this.suppliers.performance(organizationId, supplierId);
  }

  @Post()
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  create(@Param('organizationId') organizationId: string, @Body() input: CreateSupplierDto) {
    return this.suppliers.create(organizationId, input);
  }

  @Patch(':supplierId')
  @Roles('ADMIN', 'PURCHASER')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
    @Body() input: UpdateSupplierDto,
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('Provide at least one field to update.');
    }
    return this.suppliers.update(organizationId, supplierId, input);
  }

  @Post(':supplierId/archive')
  @Roles('ADMIN', 'PURCHASER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  archive(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
  ) {
    return this.suppliers.setArchived(organizationId, supplierId, true);
  }

  @Post(':supplierId/restore')
  @Roles('ADMIN', 'PURCHASER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  restore(
    @Param('organizationId') organizationId: string,
    @Param('supplierId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) supplierId: string,
  ) {
    return this.suppliers.setArchived(organizationId, supplierId, false);
  }
}
