import { IsDefined } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSectionDto {
  // Shape varies by section type (object for personal_info/summary, array for the
  // rest) — real validation happens against SECTION_SCHEMAS in SectionsService, not
  // here. @IsDefined() only exists so the global ValidationPipe's whitelist doesn't
  // strip this property (it drops anything with zero validator decorators).
  @ApiProperty({
    description:
      "New content for this section. Shape must match the section type's schema.",
    type: 'object',
    additionalProperties: true,
  })
  @IsDefined()
  content: unknown;
}
