import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiDataResponse } from 'src/common/swagger/api-response.decorator';
import { Plan } from './entities/plan.entity';
import { PlanResponse } from './dto/plan-response.dto';

// @Public(): pricing must be visible to a logged-out visitor deciding whether to sign
// up at all — the global JwtAuthGuard would otherwise 401 this route.
@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List active plans, ordered for a pricing page' })
  @ApiDataResponse(200, PlanResponse, 'Active plans only.', { isArray: true })
  async list() {
    const plans = await this.plans.find({
      where: { active: true },
      order: { displayOrder: 'ASC' },
    });
    return plans.map((p) => new PlanResponse(p));
  }
}
