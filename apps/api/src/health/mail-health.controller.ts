import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';
import { MailMetrics } from './mail-metrics.service';

@Public()
@SkipThrottle()
@Controller('health/mail')
export class MailHealthController {
  constructor(private readonly metrics: MailMetrics) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  check() {
    return { service: 'stockflow-api', ...this.metrics.snapshot() };
  }
}
