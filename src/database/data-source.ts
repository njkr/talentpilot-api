import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PromptTemplate } from '../prompts/entities/prompt-template.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';

// Single source of truth for the DB connection, shared by:
//  - the Nest app (via TypeOrmModule.forRootAsync in app.module.ts)
//  - the TypeORM CLI (migration:generate / migration:run / migration:revert)
// The CLI has no Nest DI container, so this reads process.env directly
// (via dotenv/config) rather than through the Env service.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  poolSize: process.env.DB_POOL_SIZE ? Number(process.env.DB_POOL_SIZE) : 10,
  entities: [
    User,
    RefreshToken,
    VerificationToken,
    AuditLog,
    Profile,
    Resume,
    ResumeSection,
    Workspace,
    PromptTemplate,
    TokenUsage,
  ],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false, // migrations only — see Sprint 1 §2
  logging: process.env.NODE_ENV === 'development',
};

// The CLI needs an actual DataSource instance (not just options).
export default new DataSource(dataSourceOptions);
