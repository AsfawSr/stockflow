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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import {
  CreateProductDto,
  ImportProductsDto,
  ListProductsDto,
  UpdateProductDto,
} from './products.dto';
import { ProductsService } from './products.service';

@Controller('organizations/:organizationId/products')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: ListProductsDto) {
    return this.products.list(organizationId, query);
  }

  @Get(':productId')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('organizationId') organizationId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
  ) {
    return this.products.get(organizationId, productId);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  @Header('Cache-Control', 'no-store')
  create(@Param('organizationId') organizationId: string, @Body() input: CreateProductDto) {
    return this.products.create(organizationId, input);
  }

  @Post('import')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  importCsv(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: ImportProductsDto,
  ) {
    return this.products.importCsv(organizationId, request.principal.user.id, input.csv);
  }

  @Patch(':productId')
  @Roles('ADMIN', 'MANAGER')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('organizationId') organizationId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
    @Body() input: UpdateProductDto,
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('Provide at least one field to update.');
    }
    return this.products.update(organizationId, productId, input);
  }

  @Post(':productId/archive')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  archive(
    @Param('organizationId') organizationId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
  ) {
    return this.products.setArchived(organizationId, productId, true);
  }

  @Post(':productId/restore')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  restore(
    @Param('organizationId') organizationId: string,
    @Param('productId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) productId: string,
  ) {
    return this.products.setArchived(organizationId, productId, false);
  }
}
