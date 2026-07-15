import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;

  // citext requires the extension; it makes uniqueness case-insensitive at the DB level
  // so 'Bob@x.com' and 'bob@x.com' cannot both exist. We also lowercase on write.
  @Index({ unique: true })
  @Column({ type: 'citext' })
  email: string;

  @Column({ name: 'password_hash', select: false }) // never loaded unless explicitly selected
  @Exclude() // never serialized even if it is
  passwordHash: string;

  @Column({ type: 'varchar', default: 'user' }) // varchar, not pg enum (Addendum §4.11)
  role: 'user' | 'admin';

  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'suspended' | 'deleted';

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  // Bumping this invalidates every access token issued before it — used by
  // password reset ("log me out everywhere") without a token denylist.
  @Column({ name: 'token_version', default: 0 })
  tokenVersion: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
