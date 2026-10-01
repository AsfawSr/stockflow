import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTransport, Transporter } from 'nodemailer';
import { MailMetrics } from '../health/mail-metrics.service';

export type AccountEmail = { to: string; subject: string; text: string; actionUrl: string };

@Injectable()
export class AccountMailer implements OnModuleDestroy {
  private readonly transport?: Transporter;
  readonly webOrigin: string;
  private readonly from: string;

  constructor(
    config: ConfigService,
    private readonly metrics: MailMetrics,
  ) {
    const production = config.get('NODE_ENV') === 'production';
    const origin = new URL(
      config.get<string>('WEB_ORIGIN') ?? (production ? '' : 'http://127.0.0.1:3000'),
    );
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      (production && origin.protocol !== 'https:')
    ) {
      throw new Error('WEB_ORIGIN must be a trusted HTTP origin (HTTPS in production).');
    }
    this.webOrigin = origin.origin;
    this.from = config.get<string>('MAIL_FROM') || 'StockFlow <no-reply@example.test>';
    const mode = config.get<string>('MAIL_TRANSPORT') ?? (production ? 'smtp' : 'file');
    if (mode === 'file' && !production) return;
    if (mode !== 'smtp') throw new Error('Production email requires MAIL_TRANSPORT=smtp.');
    const host = config.getOrThrow<string>('SMTP_HOST');
    if (!host || !config.get<string>('MAIL_FROM'))
      throw new Error('SMTP_HOST and MAIL_FROM are required.');
    const port = Number(config.get('SMTP_PORT') ?? 587);
    const user = config.get<string>('SMTP_USER');
    this.transport = createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: user ? { user, pass: config.getOrThrow<string>('SMTP_PASSWORD') } : undefined,
      connectionTimeout: 1500,
      greetingTimeout: 1500,
      socketTimeout: 3000,
    });
  }

  async send(message: AccountEmail): Promise<void> {
    try {
      await this.deliver(message);
      this.metrics.recordSuccess();
    } catch (error) {
      this.metrics.recordFailure();
      throw error;
    }
  }

  private async deliver(message: AccountEmail): Promise<void> {
    if (this.transport) {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return;
    }
    const directory = resolve(__dirname, '../../.local/mail');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const recipientHash = createHash('sha256').update(message.to).digest('hex');
    await writeFile(
      resolve(directory, `${recipientHash}-${randomUUID()}.json`),
      JSON.stringify(message, null, 2),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
  }

  onModuleDestroy() {
    this.transport?.close();
  }
}
