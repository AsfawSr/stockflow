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
  UseGuards,
} from '@nestjs/common';
import { VerifiedEmailGuard } from '../auth/auth.guard';
import { ListQueryDto } from '../common/list-query.dto';
import { OrganizationAccessGuard, Roles } from '../organizations/organization-access.guard';
import { CreateLocationDto, UpdateLocationDto } from './locations.dto';
import { LocationsService } from './locations.service';

@Controller('organizations/:organizationId/locations')
@UseGuards(VerifiedEmailGuard, OrganizationAccessGuard)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Param('organizationId') organizationId: string, @Query() query: ListQueryDto) {
    return this.locations.list(organizationId, query);
  }

  @Get(':locationId')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('organizationId') organizationId: string,
    @Param('locationId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) locationId: string,
  ) {
    return this.locations.get(organizationId, locationId);
  }

  @Post()
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  create(@Param('organizationId') organizationId: string, @Body() input: CreateLocationDto) {
    return this.locations.create(organizationId, input);
  }

  @Patch(':locationId')
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('organizationId') organizationId: string,
    @Param('locationId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) locationId: string,
    @Body() input: UpdateLocationDto,
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('Provide at least one field to update.');
    }
    return this.locations.update(organizationId, locationId, input);
  }

  @Post(':locationId/archive')
  @Roles('ADMIN')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  archive(
    @Param('organizationId') organizationId: string,
    @Param('locationId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) locationId: string,
  ) {
    return this.locations.setArchived(organizationId, locationId, true);
  }

  @Post(':locationId/restore')
  @Roles('ADMIN')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  restore(
    @Param('organizationId') organizationId: string,
    @Param('locationId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) locationId: string,
  ) {
    return this.locations.setArchived(organizationId, locationId, false);
  }
}
