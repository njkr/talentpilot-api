import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('prompt_templates')
// Exactly one active version per key. A partial unique index makes that a database
// invariant — a service-layer check would race two admins activating different versions.
@Index('one_active_version_per_key', ['key'], {
  unique: true,
  where: 'is_active = true',
})
@Unique(['key', 'version'])
export class PromptTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() key: string; // 'resume_extraction'
  @Column({ type: 'int' }) version: number;

  @Column() model: string; // 'gpt-4o-mini'
  @Column({ type: 'numeric', precision: 3, scale: 2, default: 0.1 })
  temperature: string;
  @Column({ name: 'max_tokens', type: 'int', default: 4096 }) maxTokens: number;

  @Column({ name: 'system_template', type: 'text' }) systemTemplate: string;
  @Column({ name: 'user_template', type: 'text' }) userTemplate: string;

  // Declared inputs, e.g. ['resume_text']. render() asserts every one is supplied —
  // a typo'd variable name becomes a startup-time error, not a silent "{{resume_txt}}"
  // literal sent to the model.
  @Column({ type: 'jsonb', default: () => "'[]'" }) variables: string[];

  // Name of the Zod schema in the code registry. The DB stores WHICH schema, the code
  // stores the schema itself — types can't live in a jsonb column.
  @Column({ name: 'schema_key' }) schemaKey: string;

  @Column({ name: 'is_active', default: false }) isActive: boolean;
  @Column({ name: 'change_note', type: 'text', nullable: true })
  changeNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
