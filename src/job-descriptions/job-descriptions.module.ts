import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Env } from 'src/config/config.module';
import { JobDescription } from './entities/job-description.entity';
import { JobDescriptionsController } from './job-descriptions.controller';
import { JobDescriptionsService } from './job-descriptions.service';
import { AiModule } from '../ai/ai.module';
import { ResumesModule } from '../resumes/resumes.module'; // for FileValidatorService/TextExtractorService

@Module({
  imports: [
    TypeOrmModule.forFeature([JobDescription]),
    AiModule,
    ResumesModule,
    // Same reasoning as ResumesModule's own registration: config-driven size limit
    // needs Env via DI, which a decorator argument can't provide.
    MulterModule.registerAsync({
      useFactory: (env: Env) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: env.get('MAX_FILE_SIZE_MB') * 1024 * 1024,
          files: 1,
          fields: 5,
        },
      }),
      inject: [Env],
    }),
  ],
  controllers: [JobDescriptionsController],
  providers: [JobDescriptionsService],
  exports: [JobDescriptionsService],
})
export class JobDescriptionsModule {}
