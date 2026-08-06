import { PartialType } from '@nestjs/mapped-types';
import { CreateAffiliateLinkDto } from './create-affiliate-link.dto';

// All fields optional — PATCH only changes what's given.
export class UpdateAffiliateLinkDto extends PartialType(
  CreateAffiliateLinkDto,
) {}
