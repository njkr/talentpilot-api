import { ApiProperty } from '@nestjs/swagger';
import { RefreshToken } from '../entities/refresh-token.entity';

// One row per active session (refresh token family). The raw token id/hash
// never leaves the server — only what's useful for a "manage devices" screen.
export class SessionInfoResponse {
  @ApiProperty({
    format: 'uuid',
    description:
      'Identifies the whole device session, not a single token. Pass this to DELETE /auth/sessions/:familyId to sign that device out.',
  })
  familyId: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'When this device last logged in or refreshed (rotation reuses the family, not this timestamp).',
  })
  createdAt: Date;

  @ApiProperty({ nullable: true, example: '203.0.113.7' })
  ip: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  })
  userAgent: string | null;

  constructor(t: RefreshToken) {
    Object.assign(this, {
      familyId: t.familyId,
      createdAt: t.createdAt,
      ip: t.ip,
      userAgent: t.userAgent,
    });
  }
}
