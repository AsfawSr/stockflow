import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AccountService } from './account.service';
import { AccountMailer } from './account-mailer.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccountService, AccountMailer],
  exports: [AuthService],
})
export class AuthModule {}
