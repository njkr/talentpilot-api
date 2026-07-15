import { SetMetadata } from '@nestjs/common';

export const Roles = (...r: string[]) => SetMetadata('roles', r);
