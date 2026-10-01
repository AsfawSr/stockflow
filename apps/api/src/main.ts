import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Count only configured ingress hops when attributing client addresses.
  const trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  if (Number.isInteger(trustedHops) && trustedHops > 0) app.set('trust proxy', trustedHops);
  await app.listen(process.env.PORT ?? 3001, '127.0.0.1');
}

void bootstrap();
