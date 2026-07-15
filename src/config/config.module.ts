import { Global, Injectable, Module } from '@nestjs/common';
import {
  ConfigModule as NestConfigModule,
  ConfigService,
} from '@nestjs/config';
import { EnvType, validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),
  ],
})
export class ConfigModule {}

@Injectable()
export class Env {
  constructor(private readonly cfg: ConfigService<EnvType, true>) {}

  get<K extends keyof EnvType>(k: K): EnvType[K] {
    return this.cfg.get(k, { infer: true });
  }
}
