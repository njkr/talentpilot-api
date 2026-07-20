import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { ApiDataResponse } from 'src/common/swagger/api-response.decorator';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponse } from './dto/profile-response.dto';

@ApiTags('profiles')
@ApiBearerAuth('access-token')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  @ApiOperation({
    summary: "Get the current user's profile",
    description:
      'Returns an empty shell (all fields null, completeness 0) if the user has never ' +
      'saved a profile — this is never a 404.',
  })
  @ApiDataResponse(200, ProfileResponse, 'The profile, or an empty shell.')
  async get(@CurrentUser() user: User) {
    const p = await this.profiles.get(user.id);
    return new ProfileResponse(p, this.profiles.completeness(p));
  }

  @Put('me') // PUT, not PATCH — it's an upsert of the whole profile
  @ApiOperation({
    summary: 'Create or update the profile',
    description:
      'Upsert: works whether or not a profile row exists yet. Only send the fields you ' +
      'want to set — omitted fields are left untouched, not cleared.',
  })
  @ApiDataResponse(200, ProfileResponse, 'The saved profile.')
  async update(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    const p = await this.profiles.upsert(user.id, dto);
    return new ProfileResponse(p, this.profiles.completeness(p));
  }
}
