import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiErrorBody,
  AppException,
  ErrorCode,
} from '../exceptions/app.exception';
import { ThrottlerException } from '@nestjs/throttler';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(ex: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    let status = 500;
    let body: ApiErrorBody = {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong.',
    };

    if (ex instanceof AppException) {
      status = ex.getStatus();
      const r = ex.getResponse() as any;
      body = { code: r.code, message: r.message, details: r.details };
    } else if (ex instanceof BadRequestException) {
      // class-validator errors → fields map
      status = 400;
      const r = ex.getResponse() as any;
      const raw: string[] = Array.isArray(r.message) ? r.message : [r.message];
      const fields: Record<string, string[]> = {};
      for (const m of raw) {
        const key = m.split(' ')[0]; // class-validator prefixes the property
        (fields[key] ??= []).push(m);
      }
      body = {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed.',
        fields,
      };
    } else if (ex instanceof ThrottlerException) {
      status = 429;
      body = {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests. Slow down.',
        details: { retryAfterSec: 60 },
      };
    } else if (ex instanceof UnauthorizedException) {
      status = 401;
      body = { code: ErrorCode.TOKEN_INVALID, message: 'Not authenticated.' };
    } else if (ex instanceof HttpException) {
      status = ex.getStatus();
      body = {
        code: status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL_ERROR,
        message: ex.message,
      };
    } else if ((ex as any)?.code === '23505') {
      // Postgres unique violation
      status = 409;
      body = {
        code: ErrorCode.ALREADY_EXISTS,
        message: 'That already exists.',
      };
    }

    if (status >= 500) {
      this.logger.error(
        { err: ex, requestId: req.requestId, path: req.url },
        'unhandled',
      );
      // Sentry.captureException(ex, { tags: { requestId: req.requestId } });
    }

    res.status(status).json({
      success: false,
      error: body,
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  }
}
