import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ReadinessController } from './health/readiness.controller';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    ProductsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
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
