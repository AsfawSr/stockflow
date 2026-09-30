import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, OrganizationsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
