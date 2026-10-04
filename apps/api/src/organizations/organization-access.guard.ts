import {
  BadRequestException,
  CanActivate,
  ConflictException,
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

// Marks routes that must stay usable while the organization is archived.
export const AllowArchived = () => SetMetadata('stockflow.allowArchived', true);

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
      select: { roles: true, organization: { select: { archivedAt: true } } },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    const requiredRoles = this.reflector.getAllAndOverride<OrganizationRole[]>(
      'stockflow.organizationRoles',
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles?.length && !requiredRoles.some((role) => membership.roles.includes(role))) {
      throw new ForbiddenException('Insufficient organization permissions.');
    }
    const allowArchived = this.reflector.getAllAndOverride<boolean>('stockflow.allowArchived', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (membership.organization.archivedAt && request.method !== 'GET' && !allowArchived) {
      throw new ConflictException('This organization is archived and read-only.');
    }
    return true;
  }
}
