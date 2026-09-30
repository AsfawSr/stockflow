import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CleanupService } from './cleanup.service';

@Module({
  imports: [PrismaModule],
  providers: [CleanupService],
})
export class MaintenanceModule {}
