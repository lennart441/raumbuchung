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
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { UserRole, BookingStatus } from '@prisma/client';
import { AppService } from './app.service';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Roles } from './auth/roles.decorator';
import { AuthUser } from './auth/request-user';

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
  note?: string;
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
  note?: string;
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
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth() {
    return this.appService.getHealth();
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

  @UseGuards(AuthGuard)
  @Post('bookings')
  async createBooking(
    @Req() req: RequestWithUser,
    @Body() body: CreateBookingDto,
  ) {
    return this.appService.createBooking(req.user, {
      roomId: body.roomId,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      note: body.note,
    });
  }

  @UseGuards(AuthGuard)
  @Get('bookings/me')
  async myBookings(@Req() req: RequestWithUser) {
    return this.appService.myBookings(req.user);
  }

  @UseGuards(AuthGuard)
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
      note: body.note,
    });
  }

  @UseGuards(AuthGuard)
  @Delete('bookings/:id')
  async deleteBooking(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.appService.deleteBooking(req.user, id);
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
