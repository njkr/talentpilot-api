import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { AdminGuard } from './guards/admin.guard';
import { PaymentConfigService } from '../payments/config/payment-config.service';
import { UpdatePaymentConfigDto } from './dto/update-payment-config.dto';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/payment-config')
export class AdminPaymentConfigController {
  constructor(private readonly config: PaymentConfigService) {}

  @Get()
  @ApiOperation({
    summary:
      'Read the live payment/credit config (costs, grants, feature flags)',
  })
  get() {
    return this.config.get();
  }

  @Patch()
  @ApiOperation({
    summary: 'Edit the payment/credit config',
    description:
      'Propagates to the credit path within 60s (PaymentConfigService caches reads). ' +
      'Writes an audit row.',
  })
  update(@Body() dto: UpdatePaymentConfigDto, @CurrentUser() admin: User) {
    return this.config.update(dto, admin.id);
  }
}
