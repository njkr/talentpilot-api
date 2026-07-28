import { randomInt } from 'crypto';

// Excludes 0/O and 1/I — the pair that gets misread out loud or mistyped when someone
// shares a referral code verbally or from memory, same concern OtpService's own code
// generation avoids for the same reason.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReferralCode(length = 7): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
