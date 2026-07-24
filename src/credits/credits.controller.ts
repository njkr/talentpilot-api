import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import { ApiDataResponse } from 'src/common/swagger/api-response.decorator';
import { CreditService } from './credit.service';
import {
  CreditBalanceResponse,
  CreditLedgerResponse,
} from './dto/credit-ledger-response.dto';

@ApiTags('credits')
@ApiBearerAuth('access-token')
@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditService) {}

  @Get()
  @ApiOperation({ summary: "The current user's credit balance" })
  @ApiDataResponse(200, CreditBalanceResponse, 'SUM of the append-only ledger.')
  async balance(@CurrentUser() user: User) {
    return new CreditBalanceResponse(await this.credits.balance(user.id));
  }

  @Get('history')
  @ApiOperation({
    summary:
      'Cursor-paginated credit ledger (grants, debits, refunds), newest first',
  })
  @ApiDataResponse(
    200,
    CreditLedgerResponse,
    'Every entry that makes up the balance.',
    {
      isArray: true,
    },
  )
  async history(@CurrentUser() user: User, @Query() q: CursorQueryDto) {
    const page = await this.credits.history(user.id, q);
    return {
      ...page,
      data: page.data.map((l) => new CreditLedgerResponse(l)),
    };
  }
}
