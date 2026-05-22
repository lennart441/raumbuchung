import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  DecisionType,
  Prisma,
  SeriesRecurrence,
  UserRole,
} from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AuthUser } from './auth/request-user';
import { resolveRoleFromClaims } from './auth/role-resolution';
import { MailService } from './mail.service';

export type SeriesRecurrenceInput = 'DAILY' | 'WEEKLY' | 'MONTHLY';

type CreateBookingInput = {
  roomId: string;
  startAt: Date;
  endAt: Date;
  title?: string;
  description?: string;
};

type UpdateBookingInput = {
  roomId?: string;
  startAt?: Date;
  endAt?: Date;
  title?: string;
  description?: string;
};

type SeriesBookingInput = {
  roomId: string;
  startAt: Date;
  endAt: Date;
  recurrence: SeriesRecurrenceInput;
  until: string;
  title?: string;
  description?: string;
  skipStartAts?: string[];
};

type UpdateSeriesInput = {
  roomId?: string;
  title?: string;
  description?: string;
  startAt?: Date;
  endAt?: Date;
};

type BookingTx = Pick<PrismaService, 'roomBlock' | 'booking'>;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function advanceOccurrence(
  start: Date,
  end: Date,
  recurrence: SeriesRecurrenceInput,
): { startAt: Date; endAt: Date } {
  const duration = end.getTime() - start.getTime();
  const ns = new Date(start);
  if (recurrence === 'DAILY') {
    ns.setDate(ns.getDate() + 1);
  } else if (recurrence === 'WEEKLY') {
    ns.setDate(ns.getDate() + 7);
  } else {
    const day = ns.getDate();
    ns.setMonth(ns.getMonth() + 1);
    if (ns.getDate() !== day) {
      ns.setDate(0);
    }
  }
  return { startAt: ns, endAt: new Date(ns.getTime() + duration) };
}

function expandSeriesOccurrences(
  firstStart: Date,
  firstEnd: Date,
  recurrence: SeriesRecurrenceInput,
  untilDateStr: string,
): Array<{ startAt: Date; endAt: Date }> {
  const untilKey = untilDateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilKey)) {
    throw new BadRequestException('Serien-Ende (until) muss YYYY-MM-DD sein');
  }
  const out: Array<{ startAt: Date; endAt: Date }> = [];
  let startAt = new Date(firstStart);
  let endAt = new Date(firstEnd);
  let guard = 0;
  while (localDateKey(startAt) <= untilKey && guard++ < 500) {
    out.push({ startAt: new Date(startAt), endAt: new Date(endAt) });
    const next = advanceOccurrence(startAt, endAt, recurrence);
    startAt = next.startAt;
    endAt = next.endAt;
  }
  return out;
}

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  getHealth() {
    return { ok: true };
  }

  async ensureUser(identity: AuthUser) {
    const role = this.resolveRole(identity);
    const birthDate = this.parseBirthDate(identity.birthDate);
    return this.prisma.user.upsert({
      where: { authentikSub: identity.sub },
      update: {
        email: identity.email,
        displayName: identity.name,
        phone: identity.phone,
        birthDate,
        street: identity.street,
        houseNumber: identity.houseNumber,
        postalCode: identity.postalCode,
        city: identity.city,
        role,
      },
      create: {
        authentikSub: identity.sub,
        email: identity.email,
        displayName: identity.name,
        phone: identity.phone,
        birthDate,
        street: identity.street,
        houseNumber: identity.houseNumber,
        postalCode: identity.postalCode,
        city: identity.city,
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
      phone: user.phone,
      birthDate: user.birthDate,
      street: user.street,
      houseNumber: user.houseNumber,
      postalCode: user.postalCode,
      city: user.city,
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
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        isOverbooked: true,
      },
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
    this.assertValidRange(input.startAt, input.endAt);

    const room = await this.prisma.room.findUnique({
      where: { id: input.roomId },
    });
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

    const booking = await this.prisma.booking.create({
      data: {
        roomId: input.roomId,
        userId: user.id,
        startAt: input.startAt,
        endAt: input.endAt,
        title: input.title,
        description: input.description,
        isOverbooked,
        status,
      },
      include: { room: true, user: true },
    });

    this.mailService.sendBookingCreatedMail(booking);
    return booking;
  }

  async previewSeriesBookings(identity: AuthUser, input: SeriesBookingInput) {
    const user = await this.ensureUser(identity);
    await this.assertUserCanBook(user.id, input.roomId);
    this.assertValidRange(input.startAt, input.endAt);
    const room = await this.prisma.room.findUnique({
      where: { id: input.roomId },
    });
    if (!room || !room.isActive) {
      throw new NotFoundException('Raum nicht gefunden');
    }

    const slots = expandSeriesOccurrences(
      input.startAt,
      input.endAt,
      input.recurrence,
      input.until,
    );
    if (slots.length === 0) {
      throw new BadRequestException('Keine Termine im gewählten Zeitraum');
    }

    const occurrences = await Promise.all(
      slots.map(async (slot) => {
        const { conflict, reason } = await this.checkSlotConflict(
          input.roomId,
          slot.startAt,
          slot.endAt,
        );
        return {
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          conflict,
          reason: conflict ? reason : undefined,
        };
      }),
    );

    return { occurrences };
  }

  async createSeriesBookings(identity: AuthUser, input: SeriesBookingInput) {
    const user = await this.ensureUser(identity);
    await this.assertUserCanBook(user.id, input.roomId);
    this.assertValidRange(input.startAt, input.endAt);

    const room = await this.prisma.room.findUnique({
      where: { id: input.roomId },
    });
    if (!room || !room.isActive) {
      throw new NotFoundException('Raum nicht gefunden');
    }

    const slots = expandSeriesOccurrences(
      input.startAt,
      input.endAt,
      input.recurrence,
      input.until,
    );
    if (slots.length === 0) {
      throw new BadRequestException('Keine Termine im gewählten Zeitraum');
    }

    const skipMs = new Set(
      (input.skipStartAts ?? []).map((s) => new Date(s).getTime()),
    );

    const skippedExplicit: Array<{ startAt: string; endAt: string }> = [];
    const skippedConflict: Array<{
      startAt: string;
      endAt: string;
      reason?: string;
    }> = [];

    const untilDate = new Date(`${input.until.trim().slice(0, 10)}T12:00:00`);

    const slotsToCreate: Array<{ startAt: Date; endAt: Date }> = [];
    for (const slot of slots) {
      const t = slot.startAt.getTime();
      if (skipMs.has(t)) {
        skippedExplicit.push({
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
        });
        continue;
      }
      const { conflict, reason } = await this.checkSlotConflict(
        input.roomId,
        slot.startAt,
        slot.endAt,
      );
      if (conflict) {
        skippedConflict.push({
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          reason,
        });
        continue;
      }
      slotsToCreate.push(slot);
    }

    if (slotsToCreate.length === 0) {
      return {
        seriesId: null,
        created: [],
        skippedExplicit,
        skippedConflict,
      };
    }

    const { seriesId, created } = await this.prisma.$transaction(async (tx) => {
      const series = await tx.bookingSeries.create({
        data: {
          roomId: input.roomId,
          userId: user.id,
          recurrence: input.recurrence as SeriesRecurrence,
          untilDate,
          title: input.title,
          description: input.description,
        },
      });

      const out: Prisma.BookingGetPayload<{
        include: { room: true; user: true };
      }>[] = [];
      for (const slot of slotsToCreate) {
        const isOverbooked = false;
        const status =
          user.role === UserRole.EXTENDED_USER && !isOverbooked
            ? BookingStatus.APPROVED
            : BookingStatus.PENDING;

        const booking = await tx.booking.create({
          data: {
            roomId: input.roomId,
            userId: user.id,
            seriesId: series.id,
            startAt: slot.startAt,
            endAt: slot.endAt,
            title: input.title,
            description: input.description,
            isOverbooked,
            status,
          },
          include: { room: true, user: true },
        });
        out.push(booking);
      }
      return { seriesId: series.id, created: out };
    });

    const series = await this.loadSeriesForMail(seriesId);
    this.mailService.sendSeriesCreatedMails(series);

    return { seriesId, created, skippedExplicit, skippedConflict };
  }

  async myBookings(identity: AuthUser) {
    const user = await this.ensureUser(identity);
    return this.prisma.booking.findMany({
      where: { userId: user.id },
      include: {
        room: true,
        decisions: true,
        series: { include: { room: true } },
      },
      orderBy: { startAt: 'desc' },
    });
  }

  async getBookingSeries(identity: AuthUser, seriesId: string) {
    const actor = await this.ensureUser(identity);
    const series = await this.prisma.bookingSeries.findUnique({
      where: { id: seriesId },
      include: {
        room: true,
        user: true,
        bookings: { include: { room: true, decisions: true }, orderBy: { startAt: 'asc' } },
      },
    });
    if (!series) throw new NotFoundException('Serie nicht gefunden');
    this.assertSeriesAccess(actor, series);
    return series;
  }

  async updateBookingSeries(
    identity: AuthUser,
    seriesId: string,
    input: UpdateSeriesInput,
  ) {
    const actor = await this.ensureUser(identity);
    const series = await this.prisma.bookingSeries.findUnique({
      where: { id: seriesId },
      include: { bookings: true, user: true },
    });
    if (!series) throw new NotFoundException('Serie nicht gefunden');
    this.assertSeriesAccess(actor, series);

    const roomId = input.roomId ?? series.roomId;
    if (input.roomId) {
      await this.assertUserCanBook(series.userId, roomId);
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (!room || !room.isActive) {
        throw new NotFoundException('Raum nicht gefunden');
      }
    }

    const shiftTimes = input.startAt !== undefined && input.endAt !== undefined;
    if (shiftTimes) {
      this.assertValidRange(input.startAt!, input.endAt!);
    } else if (input.startAt !== undefined || input.endAt !== undefined) {
      throw new BadRequestException(
        'Fuer Serienaenderungen muessen startAt und endAt gemeinsam gesetzt werden',
      );
    }

    const sortedBookings = [...series.bookings].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    );
    const firstBooking = sortedBookings[0];
    if (!firstBooking) {
      throw new BadRequestException('Serie hat keine Termine');
    }
    const seriesBookingIds = sortedBookings.map((b) => b.id);

    let deltaMs = 0;
    let newDurationMs =
      firstBooking.endAt.getTime() - firstBooking.startAt.getTime();
    if (shiftTimes) {
      deltaMs = input.startAt!.getTime() - firstBooking.startAt.getTime();
      newDurationMs = input.endAt!.getTime() - input.startAt!.getTime();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingSeries.update({
        where: { id: seriesId },
        data: {
          ...(input.roomId ? { roomId } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
      });

      if (shiftTimes) {
        for (const booking of sortedBookings) {
          const newStartAt = new Date(booking.startAt.getTime() + deltaMs);
          const newEndAt = new Date(newStartAt.getTime() + newDurationMs);
          const { conflict } = await this.checkSlotConflict(
            roomId,
            newStartAt,
            newEndAt,
            tx,
            seriesBookingIds,
          );
          const isOverbooked = conflict;
          const status =
            series.user.role === UserRole.EXTENDED_USER && !isOverbooked
              ? BookingStatus.APPROVED
              : BookingStatus.PENDING;

          await tx.booking.update({
            where: { id: booking.id },
            data: {
              roomId,
              startAt: newStartAt,
              endAt: newEndAt,
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.description !== undefined
                ? { description: input.description }
                : {}),
              isOverbooked,
              status,
            },
          });
        }
      } else {
        await tx.booking.updateMany({
          where: { seriesId },
          data: {
            ...(input.roomId ? { roomId } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
          },
        });
      }
    });

    const updated = await this.loadSeriesForMail(seriesId);
    if (actor.role === UserRole.ADMIN) {
      this.mailService.sendSeriesUpdatedByAdminMail(updated);
    }
    return updated;
  }

  async deleteBookingSeries(identity: AuthUser, seriesId: string) {
    const actor = await this.ensureUser(identity);
    const series = await this.loadSeriesForMail(seriesId);
    this.assertSeriesAccess(actor, series);

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.deleteMany({ where: { seriesId } });
      await tx.bookingSeries.delete({ where: { id: seriesId } });
    });

    if (actor.role === UserRole.ADMIN) {
      this.mailService.sendSeriesDeletedByAdminMail(series);
    }

    return { ok: true };
  }

  async updateBooking(
    identity: AuthUser,
    bookingId: string,
    input: UpdateBookingInput,
  ) {
    const actor = await this.ensureUser(identity);
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, room: true },
    });
    if (!existing) throw new NotFoundException('Buchung nicht gefunden');

    if (actor.role !== UserRole.ADMIN && existing.userId !== actor.id) {
      throw new ForbiddenException('Keine Berechtigung fuer diese Buchung');
    }

    const roomId = input.roomId ?? existing.roomId;
    const startAt = input.startAt ?? existing.startAt;
    const endAt = input.endAt ?? existing.endAt;

    await this.assertUserCanBook(existing.userId, roomId);
    this.assertValidRange(startAt, endAt);

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) {
      throw new NotFoundException('Raum nicht gefunden');
    }

    const [blocking, conflicts] = await Promise.all([
      this.prisma.roomBlock.count({
        where: {
          roomId,
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      }),
      this.prisma.booking.count({
        where: {
          roomId,
          id: { not: bookingId },
          status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      }),
    ]);

    const isOverbooked = blocking > 0 || conflicts > 0;
    const status =
      existing.user.role === UserRole.EXTENDED_USER && !isOverbooked
        ? BookingStatus.APPROVED
        : BookingStatus.PENDING;

    const detachedSeriesId = existing.seriesId;

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        roomId,
        startAt,
        endAt,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(detachedSeriesId ? { seriesId: null } : {}),
        isOverbooked,
        status,
      },
      include: { room: true, user: true },
    });

    if (detachedSeriesId) {
      const remaining = await this.prisma.booking.count({
        where: { seriesId: detachedSeriesId },
      });
      if (remaining === 0) {
        await this.prisma.bookingSeries.delete({
          where: { id: detachedSeriesId },
        });
      }
    }

    if (actor.role === UserRole.ADMIN) {
      this.mailService.sendBookingUpdatedByAdminMail(updated);
    }

    return updated;
  }

  async deleteBooking(identity: AuthUser, bookingId: string) {
    const actor = await this.ensureUser(identity);
    const existing = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { room: true, user: true },
    });
    if (!existing) throw new NotFoundException('Buchung nicht gefunden');

    if (actor.role !== UserRole.ADMIN && existing.userId !== actor.id) {
      throw new ForbiddenException('Keine Berechtigung fuer diese Buchung');
    }

    await this.prisma.booking.delete({ where: { id: bookingId } });

    if (existing.seriesId) {
      const remaining = await this.prisma.booking.count({
        where: { seriesId: existing.seriesId },
      });
      if (remaining === 0) {
        await this.prisma.bookingSeries.delete({
          where: { id: existing.seriesId },
        });
      }
    }

    if (actor.role === UserRole.ADMIN) {
      this.mailService.sendBookingDeletedByAdminMail(existing);
    }

    return { ok: true };
  }

  async adminBookings(status?: BookingStatus) {
    return this.prisma.booking.findMany({
      where: status ? { status } : undefined,
      include: {
        room: true,
        series: { include: { room: true } },
        decisions: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            phone: true,
            birthDate: true,
            street: true,
            houseNumber: true,
            postalCode: true,
            city: true,
            role: true,
            active: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveBooking(identity: AuthUser, bookingId: string, reason?: string) {
    const admin = await this.ensureUser(identity);
    const updated = await this.applyAdminDecision(
      admin.id,
      bookingId,
      DecisionType.APPROVE,
      reason,
    );
    this.mailService.sendBookingApprovedMail(updated, reason);
    return updated;
  }

  async rejectBooking(identity: AuthUser, bookingId: string, reason?: string) {
    const admin = await this.ensureUser(identity);
    const updated = await this.applyAdminDecision(
      admin.id,
      bookingId,
      DecisionType.REJECT,
      reason,
    );
    this.mailService.sendBookingRejectedMail(
      updated,
      DecisionType.REJECT,
      reason,
    );
    return updated;
  }

  async blockBooking(identity: AuthUser, bookingId: string, reason?: string) {
    const admin = await this.ensureUser(identity);
    const updated = await this.applyAdminDecision(
      admin.id,
      bookingId,
      DecisionType.BLOCK,
      reason,
    );
    this.mailService.sendBookingRejectedMail(
      updated,
      DecisionType.BLOCK,
      reason,
    );
    return updated;
  }

  async approveBookingSeries(
    identity: AuthUser,
    seriesId: string,
    reason?: string,
  ) {
    const admin = await this.ensureUser(identity);
    await this.applySeriesAdminDecision(
      admin.id,
      seriesId,
      DecisionType.APPROVE,
      reason,
    );
    const series = await this.loadSeriesForMail(seriesId);
    this.mailService.sendSeriesApprovedMail(series, reason);
    return series;
  }

  async rejectBookingSeries(
    identity: AuthUser,
    seriesId: string,
    reason?: string,
  ) {
    const admin = await this.ensureUser(identity);
    await this.applySeriesAdminDecision(
      admin.id,
      seriesId,
      DecisionType.REJECT,
      reason,
    );
    const series = await this.loadSeriesForMail(seriesId);
    this.mailService.sendSeriesRejectedMail(
      series,
      DecisionType.REJECT,
      reason,
    );
    return series;
  }

  async blockBookingSeries(
    identity: AuthUser,
    seriesId: string,
    reason?: string,
  ) {
    const admin = await this.ensureUser(identity);
    await this.applySeriesAdminDecision(
      admin.id,
      seriesId,
      DecisionType.BLOCK,
      reason,
    );
    const series = await this.loadSeriesForMail(seriesId);
    this.mailService.sendSeriesRejectedMail(series, DecisionType.BLOCK, reason);
    return series;
  }

  async addRoomBlock(
    identity: AuthUser,
    roomId: string,
    startAt: Date,
    endAt: Date,
    reason: string,
  ) {
    const admin = await this.ensureUser(identity);
    this.assertValidRange(startAt, endAt);

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

  async banUserRoom(
    userId: string,
    roomId: string,
    reason?: string,
    endsAt?: Date,
  ) {
    return this.prisma.userRoomBan.create({
      data: { userId, roomId, reason, endsAt },
    });
  }

  async dashboard() {
    const [pendingCount, overbookedCount, recentBookings] = await Promise.all([
      this.prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      this.prisma.booking.count({
        where: { isOverbooked: true, status: BookingStatus.PENDING },
      }),
      this.prisma.booking.findMany({
        include: { user: true, room: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { pendingCount, overbookedCount, recentBookings };
  }

  private async checkSlotConflict(
    roomId: string,
    startAt: Date,
    endAt: Date,
    tx: BookingTx = this.prisma,
    excludeBookingIds: string[] = [],
  ): Promise<{ conflict: boolean; reason?: string }> {
    const block = await tx.roomBlock.findFirst({
      where: {
        roomId,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (block) {
      return { conflict: true, reason: 'Raum blockiert' };
    }
    const booking = await tx.booking.findFirst({
      where: {
        roomId,
        ...(excludeBookingIds.length > 0
          ? { id: { notIn: excludeBookingIds } }
          : {}),
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (booking) {
      return { conflict: true, reason: 'Bereits gebucht' };
    }
    return { conflict: false };
  }

  private resolveRole(identity: AuthUser): UserRole {
    return resolveRoleFromClaims(identity.role, identity.groups);
  }

  private parseBirthDate(birthDate?: string) {
    if (!birthDate) return undefined;
    const parsed = new Date(birthDate);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
  }

  private async assertUserCanBook(userId: string, roomId: string) {
    const now = new Date();
    const [user, globalBan, roomBan] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { active: true },
      }),
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
    if (!user?.active) {
      throw new ForbiddenException('Konto ist deaktiviert');
    }
    if (globalBan || roomBan) {
      throw new ForbiddenException('Buchung gesperrt');
    }
  }

  private assertValidRange(startAt: Date, endAt: Date) {
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      startAt >= endAt
    ) {
      throw new BadRequestException('Ungültiger Zeitraum');
    }
  }

  private async loadSeriesForMail(seriesId: string) {
    return this.prisma.bookingSeries.findUniqueOrThrow({
      where: { id: seriesId },
      include: {
        room: true,
        user: true,
        bookings: { orderBy: { startAt: 'asc' } },
      },
    });
  }

  private assertSeriesAccess(
    actor: { id: string; role: UserRole },
    series: { userId: string },
  ) {
    if (actor.role !== UserRole.ADMIN && series.userId !== actor.id) {
      throw new ForbiddenException('Keine Berechtigung fuer diese Serie');
    }
  }

  private async applySeriesAdminDecision(
    decidedById: string,
    seriesId: string,
    decision: DecisionType,
    reason?: string,
  ) {
    const series = await this.prisma.bookingSeries.findUnique({
      where: { id: seriesId },
      include: { bookings: true },
    });
    if (!series) throw new NotFoundException('Serie nicht gefunden');

    const targets = series.bookings.filter((b) => {
      if (decision === DecisionType.APPROVE) {
        return b.status !== BookingStatus.APPROVED;
      }
      if (decision === DecisionType.REJECT) {
        return b.status !== BookingStatus.REJECTED;
      }
      return b.status === BookingStatus.PENDING;
    });
    if (targets.length === 0) {
      throw new BadRequestException(
        decision === DecisionType.APPROVE
          ? 'Alle Termine der Serie sind bereits freigegeben'
          : decision === DecisionType.REJECT
            ? 'Alle Termine der Serie sind bereits abgelehnt'
            : 'Keine ausstehenden Termine in dieser Serie',
      );
    }

    const nextStatus =
      decision === DecisionType.APPROVE
        ? BookingStatus.APPROVED
        : decision === DecisionType.REJECT
          ? BookingStatus.REJECTED
          : BookingStatus.BLOCKED;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const booking of targets) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: nextStatus },
        });
        await tx.bookingDecision.create({
          data: {
            bookingId: booking.id,
            decidedById,
            decision,
            reason,
          },
        });
      }
    });
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
      await tx.booking.update({
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
      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { room: true, user: true },
      });
    });
  }
}
