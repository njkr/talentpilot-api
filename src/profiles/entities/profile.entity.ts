import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid') id: string;

  // 1:1 with user. UNIQUE on the FK is what enforces "one profile per user" at the DB level —
  // don't rely on the service checking first (that's a race).
  @Column({ name: 'user_id', type: 'uuid', unique: true }) userId: string;
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'first_name', nullable: true }) firstName: string | null;
  @Column({ name: 'last_name', nullable: true }) lastName: string | null;
  @Column({ nullable: true }) phone: string | null;

  @Column({ nullable: true }) linkedin: string | null;
  @Column({ nullable: true }) github: string | null;
  @Column({ nullable: true }) portfolio: string | null;

  @Column({ nullable: true }) country: string | null;
  @Column({ nullable: true }) city: string | null;
  @Column({ nullable: true }) timezone: string | null;

  @Column({ name: 'years_experience', type: 'int', nullable: true })
  yearsExperience: number | null;

  // These three feed the salary + learning prompts later. A complete profile
  // measurably improves those outputs — the UI should nudge for it.
  @Column({ name: 'target_role', nullable: true }) targetRole: string | null;
  @Column({ name: 'salary_expectation', type: 'int', nullable: true })
  salaryExpectation: number | null;
  @Column({ name: 'salary_currency', type: 'char', length: 3, nullable: true })
  salaryCurrency: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
