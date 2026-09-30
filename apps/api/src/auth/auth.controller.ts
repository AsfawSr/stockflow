import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccountTokenDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { Public } from './auth.guard';
import type { AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
  ) {}

  @Post('email/verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  async requestVerification(@Req() request: AuthenticatedRequest) {
    if (!(await this.accounts.sendVerification(request.principal.user.id)))
      throw new ServiceUnavailableException('Email delivery is unavailable. Try again later.');
    return { message: 'Verification link requested. Check your email.' };
  }

  @Public()
  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  async verifyEmail(@Body() input: AccountTokenDto) {
    await this.accounts.verifyEmail(input.token);
    return { message: 'Email verified.' };
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  async requestReset(@Body() input: EmailDto) {
    await this.accounts.requestReset(input.email);
    return { message: 'If an account exists for this address, a reset link will be sent.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  async resetPassword(@Body() input: ResetPasswordDto) {
    await this.accounts.resetPassword(input.token, input.password);
    return { message: 'Password updated. Sign in with your new password.' };
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() request: AuthenticatedRequest) {
    return request.principal.user;
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  logout(@Req() request: AuthenticatedRequest) {
    return this.auth.logout(request.principal);
  }
}
