import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, DecisionType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AuthUser } from './auth/request-user';

type CreateBookingInput = {
  roomId: string;
  startAt: Date;
  endAt: Date;
  note?: string;
};

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    return { ok: true };
  }

  async ensureUser(identity: AuthUser) {
    const role = this.resolveRole(identity);
    return this.prisma.user.upsert({
      where: { authentikSub: identity.sub },
      update: {
        email: identity.email,
        displayName: identity.name,
        role,
        active: true,
      },
      create: {
        authentikSub: identity.sub,
        email: identity.email,
        displayName: identity.name,
        role,
      },
    });
  }

  async me(identity: AuthUser) {
    const user = await this.ensureUser(identity);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
    };
  }

  async listRooms() {
    return this.prisma.room.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async getAvailability(roomId: string, from: Date, to: Date) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) {
      throw new NotFoundException('Raum nicht gefunden');
    }

    const bookings = await this.prisma.booking.findMany({
      where: {
        roomId,
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        startAt: { lt: to },
        endAt: { gt: from },
      },
      select: { id: true, startAt: true, endAt: true, status: true, isOverbooked: true },
      orderBy: { startAt: 'asc' },
    });

    const blocks = await this.prisma.roomBlock.findMany({
      where: {
        roomId,
        startAt: { lt: to },
        endAt: { gt: from },
      },
      select: { id: true, startAt: true, endAt: true, reason: true },
      orderBy: { startAt: 'asc' },
    });

    return { room, bookings, blocks };
  }

  async createBooking(identity: AuthUser, input: CreateBookingInput) {
    const user = await this.ensureUser(identity);
    await this.assertUserCanBook(user.id, input.roomId);
    await this.assertValidRange(input.startAt, input.endAt);

    const room = await this.prisma.room.findUnique({ where: { id: input.roomId } });
    if (!room || !room.isActive) {
      throw new NotFoundException('Raum nicht gefunden');
    }

    const [blocking, conflicts] = await Promise.all([
      this.prisma.roomBlock.count({
        where: {
          roomId: input.roomId,
          startAt: { lt: input.endAt },
          endAt: { gt: input.startAt },
        },
      }),
      this.prisma.booking.count({
        where: {
          roomId: input.roomId,
          status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
          startAt: { lt: input.endAt },
          endAt: { gt: input.startAt },
        },
      }),
    ]);

    const isOverbooked = blocking > 0 || conflicts > 0;
    const status =
      user.role === UserRole.EXTENDED_USER && !isOverbooked
        ? BookingStatus.APPROVED
        : BookingStatus.PENDING;

    return this.prisma.booking.create({
      data: {
        roomId: input.roomId,
        userId: user.id,
        startAt: input.startAt,
        endAt: input.endAt,
        note: input.note,
        isOverbooked,
        status,
      },
    });
  }

  async myBookings(identity: AuthUser) {
    const user = await this.ensureUser(identity);
    return this.prisma.booking.findMany({
      where: { userId: user.id },
      include: { room: true, decisions: true },
      orderBy: { startAt: 'desc' },
    });
  }

  async adminBookings(status?: BookingStatus) {
    return this.prisma.booking.findMany({
      where: status ? { status } : undefined,
      include: { room: true, user: true, decisions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveBooking(identity: AuthUser, bookingId: string, reason?: string) {
    const admin = await this.ensureUser(identity);
    return this.applyAdminDecision(admin.id, bookingId, DecisionType.APPROVE, reason);
  }

  async rejectBooking(identity: AuthUser, bookingId: string, reason?: string) {
    const admin = await this.ensureUser(identity);
    return this.applyAdminDecision(admin.id, bookingId, DecisionType.REJECT, reason);
  }

  async blockBooking(identity: AuthUser, bookingId: string, reason?: string) {
    const admin = await this.ensureUser(identity);
    return this.applyAdminDecision(admin.id, bookingId, DecisionType.BLOCK, reason);
  }

  async addRoomBlock(
    identity: AuthUser,
    roomId: string,
    startAt: Date,
    endAt: Date,
    reason: string,
  ) {
    const admin = await this.ensureUser(identity);
    await this.assertValidRange(startAt, endAt);

    return this.prisma.roomBlock.create({
      data: {
        roomId,
        startAt,
        endAt,
        reason,
        createdById: admin.id,
      },
    });
  }

  async banUserGlobal(userId: string, reason?: string, endsAt?: Date) {
    return this.prisma.userGlobalBan.create({
      data: { userId, reason, endsAt },
    });
  }

  async banUserRoom(userId: string, roomId: string, reason?: string, endsAt?: Date) {
    return this.prisma.userRoomBan.create({
      data: { userId, roomId, reason, endsAt },
    });
  }

  async dashboard() {
    const [pendingCount, overbookedCount, recentBookings] = await Promise.all([
      this.prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      this.prisma.booking.count({ where: { isOverbooked: true, status: BookingStatus.PENDING } }),
      this.prisma.booking.findMany({
        include: { user: true, room: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { pendingCount, overbookedCount, recentBookings };
  }

  private resolveRole(identity: AuthUser): UserRole {
    const groups = identity.groups ?? [];
    if (groups.includes('admin')) return UserRole.ADMIN;
    if (groups.includes('extended_user')) return UserRole.EXTENDED_USER;
    if (identity.role === 'ADMIN') return UserRole.ADMIN;
    if (identity.role === 'EXTENDED_USER') return UserRole.EXTENDED_USER;
    return UserRole.USER;
  }

  private async assertUserCanBook(userId: string, roomId: string) {
    const now = new Date();
    const [globalBan, roomBan] = await Promise.all([
      this.prisma.userGlobalBan.findFirst({
        where: {
          userId,
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
      }),
      this.prisma.userRoomBan.findFirst({
        where: {
          userId,
          roomId,
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
      }),
    ]);
    if (globalBan || roomBan) {
      throw new ForbiddenException('Buchung gesperrt');
    }
  }

  private async assertValidRange(startAt: Date, endAt: Date) {
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
      throw new BadRequestException('Ungültiger Zeitraum');
    }
  }

  private async applyAdminDecision(
    decidedById: string,
    bookingId: string,
    decision: DecisionType,
    reason?: string,
  ) {
    const nextStatus =
      decision === DecisionType.APPROVE
        ? BookingStatus.APPROVED
        : decision === DecisionType.REJECT
          ? BookingStatus.REJECTED
          : BookingStatus.BLOCKED;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException('Buchung nicht gefunden');
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: nextStatus },
      });
      await tx.bookingDecision.create({
        data: {
          bookingId,
          decidedById,
          decision,
          reason,
        },
      });
      return updated;
    });
  }
}
