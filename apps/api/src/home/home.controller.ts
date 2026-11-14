import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { HomeService } from './home.service';

/**
 * The admin Home (#48): owner and manager alike. The role comes only from the verified session;
 * the owner's answer adds the sales strip and the system line, a manager's never reads them.
 */
@Controller()
@UseGuards(StaffGuard)
export class HomeController {
  constructor(@Inject(HomeService) private readonly homeService: HomeService) {}

  @TsRestHandler(adminContract.home)
  home(@CurrentStaff() member: StaffRow) {
    return tsRestHandler(adminContract.home, async () => ({
      status: 200 as const,
      body: await this.homeService.home(member),
    }));
  }
}
