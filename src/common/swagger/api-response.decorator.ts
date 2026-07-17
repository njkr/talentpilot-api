import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiMetaDto } from './api-meta.dto';
import { ApiErrorEnvelopeDto } from './api-error.dto';

// Every 2xx response is wrapped by TransformInterceptor into
// { success: true, data: <payload>, meta } — these helpers document that
// envelope instead of the bare DTO, so Swagger UI matches what the API
// actually returns.

/** A 2xx response whose `data` is `model` (or an array of it). */
export const ApiDataResponse = <TModel extends Type<unknown>>(
  status: number,
  model: TModel,
  description: string,
  options: { isArray?: boolean } = {},
) =>
  applyDecorators(
    ApiExtraModels(ApiMetaDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          data: options.isArray
            ? { type: 'array', items: { $ref: getSchemaPath(model) } }
            : { $ref: getSchemaPath(model) },
          meta: { $ref: getSchemaPath(ApiMetaDto) },
        },
      },
    }),
  );

/** A 2xx response with no payload — `data` is always `null` (see §HttpCode(204) routes). */
export const ApiNoContentResponse = (status: number, description: string) =>
  applyDecorators(
    ApiExtraModels(ApiMetaDto),
    ApiResponse({
      status,
      description,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object', nullable: true, example: null },
          meta: { $ref: getSchemaPath(ApiMetaDto) },
        },
      },
    }),
  );

/**
 * One or more error responses, in AllExceptionsFilter's envelope:
 * { success: false, error: { code, message, ... }, meta }.
 * `statusDescriptions` maps HTTP status -> what specifically causes it on
 * this endpoint (e.g. { 401: 'Invalid credentials', 429: '5 attempts/min/IP' }).
 */
export const ApiErrorResponses = (statusDescriptions: Record<number, string>) =>
  applyDecorators(
    ApiExtraModels(ApiErrorEnvelopeDto),
    ...Object.entries(statusDescriptions).map(([status, description]) =>
      ApiResponse({
        status: Number(status),
        description,
        schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
      }),
    ),
  );
