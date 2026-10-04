import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { HealthController } from './health/health.controller';
import { ReadinessController } from './health/readiness.controller';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProductsModule } from './products/products.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { LocationsModule } from './locations/locations.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { StockModule } from './stock/stock.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MonitoringModule } from './health/monitoring.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PostgresThrottlerStorage } from './maintenance/postgres-throttler.storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AuditModule,
    OrganizationsModule,
    ProductsModule,
    SuppliersModule,
    LocationsModule,
    PurchaseOrdersModule,
    StockModule,
    InvitationsModule,
    MaintenanceModule,
    MonitoringModule,
    WebhooksModule,
    ThrottlerModule.forRootAsync({
      imports: [PrismaModule],
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) => ({
        throttlers: [{ ttl: 60000, limit: 120 }],
        // Multi-process deployments share counters through PostgreSQL.
        ...(config.get('RATE_LIMIT_STORE') === 'database'
          ? { storage: new PostgresThrottlerStorage(prisma) }
          : {}),
      }),
    }),
  ],
  controllers: [HealthController, ReadinessController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    },
  ],
})
export class AppModule {}
