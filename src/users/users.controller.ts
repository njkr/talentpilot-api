import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { UserResponseDto } from 'src/auth/dto/user-response.dto';
import {
  ApiDataResponse,
  ApiErrorResponses,
  ApiNoContentResponse,
} from 'src/common/swagger/api-response.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // The global JwtAuthGuard already protects these — no @UseGuards needed.
  // @CurrentUser() pulls req.user, which JwtStrategy populated.

  @Get('me') // "who am I" — the frontend calls this on every app load
  @ApiOperation({ summary: 'Get the current account' })
  @ApiDataResponse(200, UserResponseDto, 'The authenticated user.')
  @ApiErrorResponses({ 401: 'Missing/invalid access token.' })
  me(@CurrentUser() user: User) {
    return new UserResponseDto(user); // never returns the raw entity
  }

  @Patch('me') // edit account-level settings
  @ApiOperation({
    summary: 'Update account-level settings',
    description:
      'Placeholder: the users table has no self-editable columns yet — this always ' +
      'returns the account unchanged. Password changes go through the auth reset flow, ' +
      'never this endpoint. Career fields land on the Profile entity in a later sprint.',
  })
  @ApiDataResponse(200, UserResponseDto, 'The (currently unchanged) account.')
  @ApiErrorResponses({
    401: 'Missing/invalid access token.',
    400: 'Body contains unknown properties (rejected — see UpdateUserDto).',
  })
  async update(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return new UserResponseDto(await this.users.update(user.id, dto));
  }

  @Delete('me')
  @HttpCode(204) // GDPR: user deletes their own account
  @ApiOperation({
    summary: 'Delete the current account (GDPR)',
    description:
      'Soft delete: blocks login immediately, revokes every session, and sets deletedAt. ' +
      'The account is excluded from normal queries but kept for a 30-day grace window before a scheduled hard purge.',
  })
  @ApiNoContentResponse(204, 'Account soft-deleted and every session revoked.')
  @ApiErrorResponses({ 401: 'Missing/invalid access token.' })
  async remove(@CurrentUser() user: User) {
    await this.users.softDelete(user.id);
  }
}
