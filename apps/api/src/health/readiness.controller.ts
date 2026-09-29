import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health/ready')
export class ReadinessController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'stockflow-api', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'stockflow-api',
        database: 'unavailable',
      });
    }
  }
}