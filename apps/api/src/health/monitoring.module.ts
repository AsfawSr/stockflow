import { Module } from '@nestjs/common';
import { MailHealthController } from './mail-health.controller';
import { MailMetrics } from './mail-metrics.service';

@Module({
  controllers: [MailHealthController],
  providers: [MailMetrics],
  exports: [MailMetrics],
})
export class MonitoringModule {}
