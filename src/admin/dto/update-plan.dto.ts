import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanDto } from './create-plan.dto';

// All fields optional — PATCH only changes what's given. `key` can also be edited
// here (unlike Stripe price ids, the key isn't Stripe-managed), though changing it
// on a plan real users are already subscribed to would be unusual.
export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
