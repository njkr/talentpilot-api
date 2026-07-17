import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// require(), not `import cookieParser from 'cookie-parser'` — this project's
// tsconfig has esModuleInterop off, so a default import silently resolves to
// `undefined` at runtime (cookie-parser exports a bare function, no `.default`).
// An ES default import here keeps getting "auto-corrected" back to that broken
// form by editor tooling; require() isn't an import statement, so it can't be.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/decorators/raw-response.decorator';
import { Env } from './config/config.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const env = app.get(Env);

  // Refresh tokens travel in an httpOnly cookie (see AuthController) — without
  // this, req.cookies is always undefined and every refresh/logout call fails.
  app.use(cookieParser());

  app.enableCors({
    origin: env.get('APP_URL'),
    credentials: true, // the refresh cookie must be allowed to cross the browser/API origin
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown props
      forbidNonWhitelisted: true, // ...or reject them
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)), // honors @Exclude() on passwordHash
    new TransformInterceptor(app.get(Reflector)),
  );
  // AllExceptionsFilter and JwtAuthGuard are already registered globally via
  // APP_FILTER / APP_GUARD in app.module.ts — registering them again here would
  // just construct a second, DI-less instance that runs alongside the first.

  const config = new DocumentBuilder()
    .setTitle('TalentPilot API')
    .setDescription(
      'Every 2xx response is wrapped as `{ success: true, data, meta }` and every ' +
        'error as `{ success: false, error: { code, message, ... }, meta }` — see ' +
        'common/exceptions/app.exception.ts. Endpoints marked with a lock require a ' +
        '`Authorization: Bearer <accessToken>` header; the refresh/logout endpoints ' +
        'additionally rely on the httpOnly `tp_rt` cookie set by login/verify/refresh, ' +
        'which Swagger UI cannot attach itself — exercise those from a real client.',
    )
    .setVersion('1.0')
    .addTag(
      'auth',
      'Registration, OTP verification, login, token rotation, password reset, sessions',
    )
    .addTag('users', "The authenticated user's own account record")
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Short-lived access token from login/verify/refresh (see JWT_ACCESS_TTL).',
      },
      'access-token',
    )
    .addCookieAuth(
      'tp_rt',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'tp_rt',
        description:
          'httpOnly refresh-token cookie set by login/verify-email/refresh.',
      },
      'refresh_token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // keep the pasted bearer token across page reloads
    },
  });

  await app.listen(env.get('PORT'));
}

// A bare `bootstrap();` swallows a synchronous throw as an unhandled promise
// rejection — visible only if you know to look for it. Fail loudly instead.
bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap:', e);
  process.exit(1);
});
