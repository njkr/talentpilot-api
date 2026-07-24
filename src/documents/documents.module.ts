import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedDocument } from './entities/generated-document.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { StorageModule } from '../storage/storage.module';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';

/**
 * API-side only: request/list/status/download are pure DB + queue-enqueue, no
 * Puppeteer/docx work here. The actual rendering (DocumentsProcessor + its
 * generators/PdfService/TemplateService) lives worker-side — see worker.module.ts,
 * same split as ResumesModule/PipelineWorkerModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GeneratedDocument, Workspace, CoverLetter]),
    BullModule.registerQueue({ name: 'documents' }),
    StorageModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
