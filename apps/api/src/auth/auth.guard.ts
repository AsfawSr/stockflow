import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthPrincipal, AuthService } from './auth.service';

export const Public = () => SetMetadata('stockflow.public', true);

export interface AuthenticatedRequest extends Request {
  principal: AuthPrincipal;
}

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal?.user.emailVerifiedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before accessing organizations.',
      });
    }
    return true;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>('stockflow.public', [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Authentication required.');
    request.principal = await this.auth.authenticate(match[1]);
    return true;
  }
}
