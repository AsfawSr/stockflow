import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MonitoringModule } from '../health/monitoring.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AccountService } from './account.service';
import { AccountMailer } from './account-mailer.service';

@Module({
  imports: [PrismaModule, MonitoringModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccountService, AccountMailer],
  exports: [AuthService, AccountMailer],
})
export class AuthModule {}
