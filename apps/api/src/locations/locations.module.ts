import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [PrismaModule, OrganizationsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
