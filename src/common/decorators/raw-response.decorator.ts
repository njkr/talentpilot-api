import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { ApiSuccess } from '../exceptions/app.exception';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';

// src/common/decorators/raw-response.decorator.ts
export const RAW_RESPONSE = 'raw_response';
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

// src/common/interceptors/transform.interceptor.ts
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccess<T> | T
> {
  constructor(private reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (raw) return next.handle(); // SSE, downloads, webhook

    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      map((payload: any) => {
        // A service may return { data, meta } for lists, or a bare resource.
        const isPaged =
          payload &&
          typeof payload === 'object' &&
          'data' in payload &&
          ('nextCursor' in payload || 'hasMore' in payload);

        return {
          success: true as const,
          data: isPaged ? payload.data : (payload ?? null),
          meta: {
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
            ...(isPaged && {
              nextCursor: payload.nextCursor ?? null,
              hasMore: payload.hasMore ?? false,
              ...(payload.total !== undefined && { total: payload.total }),
            }),
          },
        };
      }),
    );
  }
}
