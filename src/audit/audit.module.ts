import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';

// Owns the audit_logs table. AuthListener writes to it directly (via AuthModule's own
// forFeature registration — TypeORM allows the same entity to be registered in
// multiple modules; they share one repository instance per connection) rather than
// through AuditService, predating it. AuditService is the shared write/read API for
// everything since Sprint 11 — in particular AdminModule's "view audit log" endpoint,
// the seam this module was originally built anticipating.
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [TypeOrmModule, AuditService],
})
export class AuditModule {}
