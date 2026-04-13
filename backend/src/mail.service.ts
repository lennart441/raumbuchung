import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Booking,
  BookingStatus,
  DecisionType,
  Room,
  User,
} from '@prisma/client';
import nodemailer, { Transporter } from 'nodemailer';

type BookingWithRelations = Booking & {
  room: Room;
  user: User;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private isEnabled: boolean;
  private readonly fromAddress: string;
  private readonly appUrl: string;
  private readonly transporter?: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.isEnabled =
      this.configService.get<string>('MAIL_ENABLED', 'false') === 'true';
    this.fromAddress = this.configService.get<string>(
      'MAIL_FROM',
      'noreply@raumbuchung.local',
    );
    this.appUrl = this.configService.get<string>(
      'MAIL_APP_URL',
      'http://localhost:8080',
    );

    if (!this.isEnabled) {
      this.logger.log('E-Mail Versand ist deaktiviert (MAIL_ENABLED=false).');
      return;
    }

    const host = this.configService.get<string>('MAIL_HOST');
    const port = Number(this.configService.get<string>('MAIL_PORT', '587'));
    const username = this.configService.get<string>('MAIL_USERNAME');
    const password = this.configService.get<string>('MAIL_PASSWORD');
    const secure =
      this.configService.get<string>('MAIL_SECURE', 'false') === 'true';

    if (!host || !username || !password || Number.isNaN(port)) {
      this.logger.warn(
        'MAIL_* Konfiguration unvollständig. E-Mail Versand wird deaktiviert.',
      );
      this.isEnabled = false;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: username,
        pass: password,
      },
    });
  }

  async sendBookingCreatedMail(booking: BookingWithRelations) {
    const isApproved = booking.status === BookingStatus.APPROVED;
    const subject = isApproved
      ? 'Deine Buchung ist bestätigt'
      : 'Deine Buchung wurde angefragt';
    const headline = isApproved
      ? 'Buchung bestätigt'
      : 'Buchung erfolgreich angefragt';
    const message = isApproved
      ? 'Dein Termin wurde direkt bestätigt und ist verbindlich im Kalender eingetragen.'
      : 'Dein Termin wurde erfasst und wartet nun auf eine Admin-Bestätigung.';

    await this.sendMailSafe(
      booking.user.email,
      subject,
      headline,
      message,
      booking,
    );
  }

  async sendBookingApprovedMail(
    booking: BookingWithRelations,
    reason?: string,
  ) {
    await this.sendMailSafe(
      booking.user.email,
      'Deine Buchung wurde bestätigt',
      'Termin bestätigt',
      'Gute Nachricht: Ein Admin hat deinen Termin bestätigt.',
      booking,
      reason,
    );
  }

  async sendBookingRejectedMail(
    booking: BookingWithRelations,
    decision: DecisionType,
    reason?: string,
  ) {
    const isBlocked = decision === DecisionType.BLOCK;
    await this.sendMailSafe(
      booking.user.email,
      isBlocked
        ? 'Deine Buchung wurde gesperrt'
        : 'Deine Buchung wurde abgelehnt',
      isBlocked ? 'Termin gesperrt' : 'Termin abgelehnt',
      isBlocked
        ? 'Ein Admin hat deinen Termin nachträglich gesperrt.'
        : 'Ein Admin hat deinen Termin leider abgelehnt.',
      booking,
      reason,
    );
  }

  async sendBookingUpdatedByAdminMail(booking: BookingWithRelations) {
    await this.sendMailSafe(
      booking.user.email,
      'Dein Termin wurde geändert',
      'Termin geändert',
      'Ein Admin hat deine Buchung aktualisiert. Bitte prüfe die neuen Zeiten.',
      booking,
    );
  }

  async sendBookingDeletedByAdminMail(booking: BookingWithRelations) {
    await this.sendMailSafe(
      booking.user.email,
      'Dein Termin wurde gelöscht',
      'Termin gelöscht',
      'Ein Admin hat deine Buchung entfernt. Bitte buche bei Bedarf erneut.',
      booking,
    );
  }

  private async sendMailSafe(
    to: string,
    subject: string,
    headline: string,
    message: string,
    booking: BookingWithRelations,
    reason?: string,
  ) {
    if (!this.isEnabled || !this.transporter) {
      return;
    }

    const startAt = this.formatDate(booking.startAt);
    const endAt = this.formatDate(booking.endAt);
    const noteSection = booking.note
      ? `<p><strong>Hinweis:</strong> ${booking.note}</p>`
      : '';
    const reasonSection = reason
      ? `<p><strong>Grund:</strong> ${reason}</p>`
      : '';
    const conflictHint = booking.isOverbooked
      ? '<p style="color:#b45309;"><strong>Hinweis:</strong> Diese Buchung betrifft einen konfliktbehafteten Zeitraum.</p>'
      : '';
    const link = `${this.appUrl}/bookings`;

    const html = `
      <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#0f172a;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8f0;">
          <h2 style="margin:0 0 12px 0;color:#111827;">${headline}</h2>
          <p style="margin:0 0 20px 0;color:#334155;">${message}</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
            <p><strong>Raum:</strong> ${booking.room.name}</p>
            <p><strong>Beginn:</strong> ${startAt}</p>
            <p><strong>Ende:</strong> ${endAt}</p>
            <p><strong>Status:</strong> ${booking.status}</p>
            ${noteSection}
            ${reasonSection}
            ${conflictHint}
          </div>
          <p style="margin-top:22px;">
            <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;">
              Zur Buchungsübersicht
            </a>
          </p>
        </div>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(
        `E-Mail Versand fehlgeschlagen an ${to}`,
        error as Error,
      );
    }
  }

  private formatDate(value: Date) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(value);
  }
}
