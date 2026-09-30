import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import type { OrganizationRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const Roles = (...roles: OrganizationRole[]) =>
  SetMetadata('stockflow.organizationRoles', roles);

@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new UnauthorizedException('Authentication required.');
    const organizationId = request.params.organizationId;
    if (typeof organizationId !== 'string' || !isUUID(organizationId)) {
      throw new BadRequestException('A valid organization id is required.');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: request.principal.user.id } },
      select: { roles: true },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    const requiredRoles = this.reflector.getAllAndOverride<OrganizationRole[]>(
      'stockflow.organizationRoles',
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles?.length && !requiredRoles.some((role) => membership.roles.includes(role))) {
      throw new ForbiddenException('Insufficient organization permissions.');
    }
    return true;
  }
}
