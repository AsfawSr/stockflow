import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestLogging } from './common/request-logging';

async function bootstrap() {
  const production = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Machine-readable logs in production; readable console output in development.
    ...(production ? { logger: new ConsoleLogger({ json: true }) } : {}),
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.use(requestLogging(new Logger('HTTP')));
  // Count only configured ingress hops when attributing client addresses.
  const trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  if (Number.isInteger(trustedHops) && trustedHops > 0) app.set('trust proxy', trustedHops);
  // Containers set HOST=0.0.0.0; local development stays loopback-only.
  await app.listen(process.env.PORT ?? 3001, process.env.HOST ?? '127.0.0.1');
}

void bootstrap();
