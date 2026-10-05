import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookRetryService } from './webhook-retry.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [PrismaModule, AuditModule, OrganizationsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcher, WebhookRetryService],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
