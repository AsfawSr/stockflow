import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health endpoint', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the API liveness status', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', service: 'stockflow-api' });
  });

  it('does not expose an unprefixed health route', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('reports readiness when the database query succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 1 }]);

    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok', service: 'stockflow-api', database: 'connected' });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 503 without leaking database errors', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('private database connection details'));

    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503)
      .expect({ status: 'error', service: 'stockflow-api', database: 'unavailable' });
  });

  it('keeps liveness independent of the database', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('database unavailable'));

    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', service: 'stockflow-api' });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});