import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import {
  ApiDataResponse,
  ApiErrorResponses,
} from 'src/common/swagger/api-response.decorator';
import { SectionsService } from './services/sections.service';
import { SectionResponse } from './dto/section-response.dto';
import { UpdateSectionDto } from './dto/update-section.dto';

@ApiTags('resumes')
@ApiBearerAuth('access-token')
@Controller('resumes/:resumeId/sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  @ApiOperation({ summary: "List a resume's parsed sections" })
  @ApiDataResponse(200, SectionResponse, 'All sections, in display order.', {
    isArray: true,
  })
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
  })
  async list(
    @CurrentUser() user: User,
    @Param('resumeId', ParseUUIDPipe) resumeId: string,
  ) {
    const rows = await this.sections.list(resumeId, user.id);
    return rows.map((r) => new SectionResponse(r));
  }

  @Patch(':sectionType')
  @ApiOperation({
    summary: 'Edit a section',
    description:
      "Overwrites this section's content. Validated against that section type's " +
      'schema before saving; marks the section as user-edited so a future re-parse ' +
      "won't overwrite it.",
  })
  @ApiDataResponse(200, SectionResponse, 'Updated.')
  @ApiErrorResponses({
    400: 'Content does not match the schema for this section type (VALIDATION_FAILED).',
    404: 'No resume with that id belongs to the current user, or no such section.',
  })
  async update(
    @CurrentUser() user: User,
    @Param('resumeId', ParseUUIDPipe) resumeId: string,
    @Param('sectionType') sectionType: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return new SectionResponse(
      await this.sections.update(resumeId, user.id, sectionType, dto.content),
    );
  }
}
