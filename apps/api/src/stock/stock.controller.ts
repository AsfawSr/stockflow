import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import {
  CreateAdjustmentDto,
  CreateTransferDto,
  StockLevelsQueryDto,
  StockMovementsQueryDto,
} from './stock.dto';
import { StockService } from './stock.service';

@Controller('organizations/:organizationId/stock')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('levels')
  @Header('Cache-Control', 'no-store')
  levels(@Param('organizationId') organizationId: string, @Query() query: StockLevelsQueryDto) {
    return this.stock.levels(organizationId, query);
  }

  @Get('levels/export')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock-levels.csv"')
  levelsExport(
    @Param('organizationId') organizationId: string,
    @Query() query: StockLevelsQueryDto,
  ) {
    return this.stock.levelsCsv(organizationId, query);
  }

  @Get('movements')
  @Header('Cache-Control', 'no-store')
  movements(
    @Param('organizationId') organizationId: string,
    @Query() query: StockMovementsQueryDto,
  ) {
    return this.stock.movements(organizationId, query);
  }

  @Get('movements/export')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock-movements.csv"')
  movementsExport(
    @Param('organizationId') organizationId: string,
    @Query() query: StockMovementsQueryDto,
  ) {
    return this.stock.movementsCsv(organizationId, query);
  }

  @Get('valuation')
  @Header('Cache-Control', 'no-store')
  valuation(@Param('organizationId') organizationId: string) {
    return this.stock.valuation(organizationId);
  }

  @Post('transfers')
  @Roles('ADMIN', 'WAREHOUSE')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  transfer(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: CreateTransferDto,
  ) {
    return this.stock.transfer(organizationId, request.principal.user.id, input);
  }

  @Post('adjustments')
  @Roles('ADMIN', 'WAREHOUSE')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  adjust(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() input: CreateAdjustmentDto,
  ) {
    return this.stock.adjust(organizationId, request.principal.user.id, input);
  }
}
