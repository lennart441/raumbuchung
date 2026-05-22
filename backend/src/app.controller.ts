import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserRole, BookingStatus } from '@prisma/client';
import { AppService } from './app.service';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Roles } from './auth/roles.decorator';
import { AuthUser } from './auth/request-user';
import { isDevAuthEnabled } from './auth/dev-auth.config';
import { BookingRateLimitGuard } from './rate-limit/booking-rate-limit.guard';

type RequestWithUser = { user: AuthUser };

class CreateBookingDto {
  @IsString()
  roomId!: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateBookingDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateSeriesDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

class SeriesBookingDto {
  @IsString()
  roomId!: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  recurrence!: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  @IsDateString()
  until!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  skipStartAts?: string[];
}

class DecisionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class RoomBlockDto {
  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsString()
  reason!: string;
}

class UserBanDto {
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('auth/config')
  authConfig() {
    return { dev: isDevAuthEnabled(this.config) };
  }

  @UseGuards(AuthGuard)
  @Get('auth/me')
  async me(@Req() req: RequestWithUser) {
    return this.appService.me(req.user);
  }

  @UseGuards(AuthGuard)
  @Get('rooms')
  async rooms() {
    return this.appService.listRooms();
  }

  @UseGuards(AuthGuard)
  @Get('rooms/:id/availability')
  async availability(
    @Param('id') roomId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.appService.getAvailability(
      roomId,
      new Date(from),
      new Date(to),
    );
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Post('bookings')
  async createBooking(
    @Req() req: RequestWithUser,
    @Body() body: CreateBookingDto,
  ) {
    return this.appService.createBooking(req.user, {
      roomId: body.roomId,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      title: body.title,
      description: body.description,
    });
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Post('bookings/series/preview')
  async previewSeriesBooking(
    @Req() req: RequestWithUser,
    @Body() body: SeriesBookingDto,
  ) {
    return this.appService.previewSeriesBookings(req.user, {
      roomId: body.roomId,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      recurrence: body.recurrence,
      until: body.until,
      title: body.title,
      description: body.description,
    });
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Post('bookings/series')
  async createSeriesBooking(
    @Req() req: RequestWithUser,
    @Body() body: SeriesBookingDto,
  ) {
    return this.appService.createSeriesBookings(req.user, {
      roomId: body.roomId,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      recurrence: body.recurrence,
      until: body.until,
      title: body.title,
      description: body.description,
      skipStartAts: body.skipStartAts,
    });
  }

  @UseGuards(AuthGuard)
  @Get('bookings/me')
  async myBookings(@Req() req: RequestWithUser) {
    return this.appService.myBookings(req.user);
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Patch('bookings/:id')
  async updateBooking(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: UpdateBookingDto,
  ) {
    return this.appService.updateBooking(req.user, id, {
      roomId: body.roomId,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
      title: body.title,
      description: body.description,
    });
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Delete('bookings/:id')
  async deleteBooking(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.appService.deleteBooking(req.user, id);
  }

  @UseGuards(AuthGuard)
  @Get('bookings/series/:seriesId')
  async getBookingSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
  ) {
    return this.appService.getBookingSeries(req.user, seriesId);
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Patch('bookings/series/:seriesId')
  async updateBookingSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
    @Body() body: UpdateSeriesDto,
  ) {
    return this.appService.updateBookingSeries(req.user, seriesId, {
      roomId: body.roomId,
      title: body.title,
      description: body.description,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
    });
  }

  @UseGuards(AuthGuard, BookingRateLimitGuard)
  @Delete('bookings/series/:seriesId')
  async deleteBookingSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
  ) {
    return this.appService.deleteBookingSeries(req.user, seriesId);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/bookings')
  async adminBookings(@Query('status') status?: BookingStatus) {
    return this.appService.adminBookings(status);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/bookings/:id/approve')
  async approve(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.appService.approveBooking(req.user, id, body.reason);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/bookings/:id/reject')
  async reject(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.appService.rejectBooking(req.user, id, body.reason);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/bookings/:id/block')
  async block(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.appService.blockBooking(req.user, id, body.reason);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/bookings/series/:seriesId/approve')
  async approveSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
    @Body() body: DecisionDto,
  ) {
    return this.appService.approveBookingSeries(
      req.user,
      seriesId,
      body.reason,
    );
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/bookings/series/:seriesId/reject')
  async rejectSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
    @Body() body: DecisionDto,
  ) {
    return this.appService.rejectBookingSeries(
      req.user,
      seriesId,
      body.reason,
    );
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/bookings/series/:seriesId/block')
  async blockSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
    @Body() body: DecisionDto,
  ) {
    return this.appService.blockBookingSeries(req.user, seriesId, body.reason);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('admin/bookings/series/:seriesId')
  async adminDeleteSeries(
    @Req() req: RequestWithUser,
    @Param('seriesId') seriesId: string,
  ) {
    return this.appService.deleteBookingSeries(req.user, seriesId);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/rooms/:id/blocks')
  async addRoomBlock(
    @Req() req: RequestWithUser,
    @Param('id') roomId: string,
    @Body() body: RoomBlockDto,
  ) {
    return this.appService.addRoomBlock(
      req.user,
      roomId,
      new Date(body.startAt),
      new Date(body.endAt),
      body.reason,
    );
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/users/:id/ban-global')
  async banGlobal(@Param('id') userId: string, @Body() body: UserBanDto) {
    return this.appService.banUserGlobal(
      userId,
      body.reason,
      body.endsAt ? new Date(body.endsAt) : undefined,
    );
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/users/:id/ban-room/:roomId')
  async banRoom(
    @Param('id') userId: string,
    @Param('roomId') roomId: string,
    @Body() body: UserBanDto,
  ) {
    return this.appService.banUserRoom(
      userId,
      roomId,
      body.reason,
      body.endsAt ? new Date(body.endsAt) : undefined,
    );
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/dashboard')
  async dashboard() {
    return this.appService.dashboard();
  }
}
