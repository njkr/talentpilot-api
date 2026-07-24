import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Env } from 'src/config/config.module';
import { Resume } from './entities/resume.entity';
import { ResumeSection } from './entities/resume-section.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { StorageModule } from 'src/storage/storage.module';
import { ResumesController } from './resumes.controller';
import { SectionsController } from './sections.controller';
import { ResumesService } from './resumes.service';
import { SectionsService } from './services/sections.service';
import { FileValidatorService } from './services/file-validator.service';
import { TextExtractorService } from './services/text-extractor.service';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Resume, Workspace, ResumeSection]),
    StorageModule,
    BullModule.registerQueue({ name: 'resumes' }), // API side: lets the service enqueue
    // Registered here (not inline on @UseInterceptors) so the size limit actually reads
    // MAX_FILE_SIZE_MB via DI — a decorator argument is evaluated once at class-definition
    // time and has no access to Env, so it can never be config-driven that way.
    MulterModule.registerAsync({
      useFactory: (env: Env) => ({
        storage: memoryStorage(), // we need the bytes in hand for magic-byte checks + hashing
        limits: {
          fileSize: env.get('MAX_FILE_SIZE_MB') * 1024 * 1024, // Multer's first line of
          files: 1, // defence, rejecting oversized bodies before they're
          fields: 5, // fully buffered; FileValidatorService is the second
        },
      }),
      inject: [Env],
    }),
    SubscriptionsModule,
  ],
  controllers: [ResumesController, SectionsController],
  providers: [
    ResumesService,
    SectionsService,
    FileValidatorService,
    TextExtractorService,
  ],
  // FileValidatorService/TextExtractorService are file-format concerns, not resume-
  // specific — JobDescriptionsModule reuses them for JD file uploads rather than
  // duplicating magic-byte sniffing and PDF/DOCX extraction a second time.
  exports: [ResumesService, FileValidatorService, TextExtractorService],
})
export class ResumesModule {}
