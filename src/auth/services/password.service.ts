import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP-aligned. 64 MiB × 3 passes ≈ 50–100ms per hash on typical hardware —
// slow enough to make offline cracking expensive, fast enough for a login endpoint.
const OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class PasswordService {
  hash(plain: string) {
    return argon2.hash(plain, OPTS);
  }
  verify(hash: string, plain: string) {
    return argon2.verify(hash, plain);
  }

  /**
   * Burns roughly the same CPU as a real verify. Called when the user does NOT exist,
   * so that "unknown email" and "wrong password" take the same wall-clock time.
   * Without this, an attacker times your endpoint and enumerates your entire user base —
   * the identical error message does NOT save you.
   */
  async fakeVerify() {
    await argon2.hash('timing-equalizer', OPTS);
  }
}
