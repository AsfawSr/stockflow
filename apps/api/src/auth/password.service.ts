import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService {
  private readonly dummyHash = this.hash(randomBytes(32).toString('base64url'));

  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }

  async matches(password: string, passwordHash?: string): Promise<boolean> {
    try {
      return await verify(passwordHash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }
}
