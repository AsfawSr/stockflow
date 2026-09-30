import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountService } from '../src/auth/account.service';

describe('Authentication HTTP boundary', () => {
  let app: INestApplication;
  const user = {
    id: 'fe0675fc-d121-4b8c-bfc9-c7f467b6aa34',
    email: 'user@example.test',
    displayName: 'User',
    emailVerifiedAt: null,
  };
  const accessToken = 'a'.repeat(43);
  const prisma = {
    user: { create: jest.fn(), findUnique: jest.fn() },
    session: { findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  };
  const passwords = { hash: jest.fn(), matches: jest.fn() };

  async function createApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PasswordService)
      .useValue(passwords)
      .overrideProvider(AccountService)
      .useValue({ sendVerification: jest.fn().mockResolvedValue(true) })
      .compile();
    const application = module.createNestApplication();
    application.setGlobalPrefix('api');
    await application.init();
    return application;
  }

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-id',
      user: { ...user, authVersion: 0 },
      authVersion: 0,
      expiresAt: new Date(Date.now() + 60000),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a bearer token on protected routes', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('does not accept credentials in query parameters', async () => {
    await request(app.getHttpServer()).get(`/api/auth/me?access_token=${accessToken}`).expect(401);
  });

  it('hashes the presented token and returns only the user profile', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(user)
      .expect('Cache-Control', 'no-store');
    expect(prisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: createHash('sha256').update(accessToken).digest('hex') },
      }),
    );
  });

  it('rejects expired and revoked sessions', async () => {
    prisma.session.findUnique.mockResolvedValueOnce({
      id: 'session-id',
      user,
      expiresAt: new Date(0),
    });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    prisma.session.findUnique.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('rejects client-controlled role and identity fields at registration', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: user.email,
        password: 'a strong test password',
        displayName: 'User',
        roles: ['ADMIN'],
        userId: user.id,
      })
      .expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects short registration passwords', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: user.email, password: 'short', displayName: 'User' })
      .expect(400);
  });

  it('normalizes registration and stores a hash rather than the access token', async () => {
    passwords.hash.mockResolvedValue('test-password-hash');
    prisma.user.create.mockResolvedValue(user);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: ' USER@EXAMPLE.TEST ',
        password: 'a strong test password',
        displayName: ' User ',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(response.body.user).toEqual(user);
    expect(response.body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const input = prisma.user.create.mock.calls[0][0].data;
    expect(input.email).toBe(user.email);
    expect(input.displayName).toBe('User');
    expect(input.credential.create.passwordHash).toBe('test-password-hash');
    expect(input.sessions.create.tokenHash).toBe(
      createHash('sha256').update(response.body.accessToken).digest('hex'),
    );
  });

  it('returns identical errors for unknown users and wrong passwords', async () => {
    passwords.matches.mockResolvedValue(false);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const unknown = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: 'a wrong test password' })
      .expect(401);
    prisma.user.findUnique.mockResolvedValueOnce({
      ...user,
      credential: { passwordHash: 'test-hash' },
    });
    const wrong = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: 'a wrong test password' })
      .expect(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(passwords.matches).toHaveBeenCalledTimes(2);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('revokes only the authenticated session at logout', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: user.id },
    });
  });

  it('throttles repeated login attempts', async () => {
    passwords.matches.mockResolvedValue(false);
    prisma.user.findUnique.mockResolvedValue(null);
    const throttledApp = await createApp();
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(throttledApp.getHttpServer())
          .post('/api/auth/login')
          .send({ email: user.email, password: 'a wrong test password' })
          .expect(401);
      }
      await request(throttledApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'a wrong test password' })
        .expect(429);
    } finally {
      await throttledApp.close();
    }
  });
});
