import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';

// Owns the audit_logs table. AuthListener writes to it (via AuthModule's own
// forFeature registration — TypeORM allows the same entity to be registered
// in multiple modules; they share one repository instance per connection).
// This module exists as the entity's home and the seam for a future
// admin-facing "view audit log" endpoint.
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  exports: [TypeOrmModule],
})
export class AuditModule {}
