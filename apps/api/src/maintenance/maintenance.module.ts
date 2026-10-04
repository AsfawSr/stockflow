import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CleanupService } from './cleanup.service';
import { DigestService } from './digest.service';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [CleanupService, DigestService],
})
export class MaintenanceModule {}
