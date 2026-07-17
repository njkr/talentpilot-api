import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

// Separate entrypoint for the BullMQ worker process (see Sprint 1 §11.5,
// gotcha #3: EmailProcessor only runs here, never inside the API process).
// Run alongside `pnpm start:dev` via `pnpm start:worker` — without this
// process running, jobs pile up in Redis and no email is ever sent, with no
// error visible on the API side.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Email worker started, listening on queue "emails"', 'Worker');
}
bootstrap();
