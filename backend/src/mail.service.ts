import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Booking,
  BookingSeries,
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

type SeriesWithRelations = BookingSeries & {
  room: Room;
  user: User;
  bookings: Booking[];
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private isEnabled: boolean;
  private readonly fromAddress: string;
  private readonly appUrl: string;
  private readonly adminEmails: string[];
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
    this.adminEmails = this.parseAdminEmails(
      this.configService.get<string>('MAIL_ADMIN_EMAIL', ''),
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
    const useImplicitTls = secure && port !== 587;

    if (secure && port === 587) {
      this.logger.warn(
        'MAIL_SECURE=true mit Port 587 erkannt. Nutze STARTTLS (secure=false) statt implizitem TLS.',
      );
    }

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
      secure: useImplicitTls,
      requireTLS: port === 587,
      auth: {
        user: username,
        pass: password,
      },
    });
  }

  sendBookingCreatedMail(booking: BookingWithRelations) {
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

    this.dispatchSingleMail(
      booking.user.email,
      subject,
      headline,
      message,
      booking,
    );
  }

  sendSeriesCreatedMails(series: SeriesWithRelations) {
    const isApproved = series.bookings.every(
      (b) => b.status === BookingStatus.APPROVED,
    );
    const userSubject = isApproved
      ? 'Deine Serienbuchung ist bestätigt'
      : 'Deine Serienbuchung wurde angefragt';
    const userHeadline = isApproved
      ? 'Serienbuchung bestätigt'
      : 'Serienbuchung erfolgreich angefragt';
    const userMessage = isApproved
      ? 'Alle Termine der Serie wurden direkt bestätigt.'
      : 'Deine Serienbuchung wurde erfasst. Alle Termine stehen in der Tabelle unten und warten auf eine Admin-Bestätigung.';

    this.dispatchSeriesMail(
      series.user.email,
      userSubject,
      userHeadline,
      userMessage,
      series,
    );

    if (this.adminEmails.length === 0) return;

    const adminSubject = 'Neue Serienbuchung zur Freigabe';
    const adminHeadline = 'Neue Serienbuchung';
    const adminMessage = `${series.user.displayName} (${series.user.email}) hat eine Serienbuchung angefragt.`;

    for (const adminEmail of this.adminEmails) {
      this.dispatchSeriesMail(
        adminEmail,
        adminSubject,
        adminHeadline,
        adminMessage,
        series,
        { showUser: true },
      );
    }
  }

  sendBookingApprovedMail(
    booking: BookingWithRelations,
    reason?: string,
  ) {
    this.dispatchSingleMail(
      booking.user.email,
      'Deine Buchung wurde bestätigt',
      'Termin bestätigt',
      'Gute Nachricht: Ein Admin hat deinen Termin bestätigt.',
      booking,
      reason,
    );
  }

  sendSeriesApprovedMail(series: SeriesWithRelations, reason?: string) {
    this.dispatchSeriesMail(
      series.user.email,
      'Deine Serienbuchung wurde bestätigt',
      'Serienbuchung bestätigt',
      'Ein Admin hat deine Serienbuchung freigegeben. Die bestätigten Termine:',
      series,
      { reason, statusFilter: [BookingStatus.APPROVED] },
    );
  }

  sendBookingRejectedMail(
    booking: BookingWithRelations,
    decision: DecisionType,
    reason?: string,
  ) {
    const isBlocked = decision === DecisionType.BLOCK;
    this.dispatchSingleMail(
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

  sendSeriesRejectedMail(
    series: SeriesWithRelations,
    decision: DecisionType,
    reason?: string,
  ) {
    const isBlocked = decision === DecisionType.BLOCK;
    this.dispatchSeriesMail(
      series.user.email,
      isBlocked
        ? 'Deine Serienbuchung wurde gesperrt'
        : 'Deine Serienbuchung wurde abgelehnt',
      isBlocked ? 'Serie gesperrt' : 'Serie abgelehnt',
      isBlocked
        ? 'Ein Admin hat die Serienbuchung gesperrt.'
        : 'Ein Admin hat die Serienbuchung abgelehnt.',
      series,
      {
        reason,
        statusFilter: isBlocked
          ? [BookingStatus.BLOCKED]
          : [BookingStatus.REJECTED],
      },
    );
  }

  sendBookingUpdatedByAdminMail(booking: BookingWithRelations) {
    this.dispatchSingleMail(
      booking.user.email,
      'Dein Termin wurde geändert',
      'Termin geändert',
      'Ein Admin hat deine Buchung aktualisiert. Bitte prüfe die neuen Zeiten.',
      booking,
    );
  }

  sendSeriesUpdatedByAdminMail(series: SeriesWithRelations) {
    this.dispatchSeriesMail(
      series.user.email,
      'Deine Serienbuchung wurde geändert',
      'Serie geändert',
      'Ein Admin hat deine Serienbuchung aktualisiert. Die aktuellen Termine:',
      series,
    );
  }

  sendBookingDeletedByAdminMail(booking: BookingWithRelations) {
    this.dispatchSingleMail(
      booking.user.email,
      'Dein Termin wurde gelöscht',
      'Termin gelöscht',
      'Ein Admin hat deine Buchung entfernt. Bitte buche bei Bedarf erneut.',
      booking,
    );
  }

  sendSeriesDeletedByAdminMail(series: SeriesWithRelations) {
    this.dispatchSeriesMail(
      series.user.email,
      'Deine Serienbuchung wurde gelöscht',
      'Serie gelöscht',
      'Ein Admin hat deine Serienbuchung entfernt. Die betroffenen Termine:',
      series,
    );
  }

  private parseAdminEmails(raw: string) {
    return raw
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  }

  private dispatchSingleMail(
    to: string,
    subject: string,
    headline: string,
    message: string,
    booking: BookingWithRelations,
    reason?: string,
  ) {
    void this.sendSingleMailSafe(to, subject, headline, message, booking, reason);
  }

  private dispatchSeriesMail(
    to: string,
    subject: string,
    headline: string,
    message: string,
    series: SeriesWithRelations,
    options?: {
      reason?: string;
      showUser?: boolean;
      statusFilter?: BookingStatus[];
    },
  ) {
    void this.sendSeriesMailSafe(
      to,
      subject,
      headline,
      message,
      series,
      options,
    );
  }

  private async sendSingleMailSafe(
    to: string,
    subject: string,
    headline: string,
    message: string,
    booking: BookingWithRelations,
    reason?: string,
  ) {
    if (!this.isEnabled || !this.transporter) return;

    const html = this.wrapHtml(
      headline,
      message,
      this.buildSingleDetails(booking, reason),
    );

    await this.send(to, subject, html);
  }

  private async sendSeriesMailSafe(
    to: string,
    subject: string,
    headline: string,
    message: string,
    series: SeriesWithRelations,
    options?: {
      reason?: string;
      showUser?: boolean;
      statusFilter?: BookingStatus[];
    },
  ) {
    if (!this.isEnabled || !this.transporter) return;

    let bookings = [...series.bookings].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    );
    if (options?.statusFilter?.length) {
      bookings = bookings.filter((b) =>
        options.statusFilter!.includes(b.status),
      );
    }

    const userSection = options?.showUser
      ? `<p><strong>Nutzer:</strong> ${this.escapeHtml(series.user.displayName)} (${this.escapeHtml(series.user.email)})</p>`
      : '';

    const reasonSection = options?.reason
      ? `<p><strong>Grund:</strong> ${this.escapeHtml(options.reason)}</p>`
      : '';

    const details = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p><strong>Raum:</strong> ${this.escapeHtml(series.room.name)}</p>
        <p><strong>Wiederholung:</strong> ${this.recurrenceLabel(series.recurrence)}</p>
        <p><strong>Serie bis:</strong> ${this.formatDate(series.untilDate)}</p>
        ${series.title ? `<p><strong>Titel:</strong> ${this.escapeHtml(series.title)}</p>` : ''}
        ${series.description ? `<p><strong>Beschreibung:</strong> ${this.escapeHtml(series.description).replace(/\n/g, '<br/>')}</p>` : ''}
        ${userSection}
        ${reasonSection}
        ${this.buildOccurrencesTable(bookings)}
      </div>
    `;

    const html = this.wrapHtml(headline, message, details);
    await this.send(to, subject, html);
  }

  private buildSingleDetails(booking: BookingWithRelations, reason?: string) {
    const startAt = this.formatDate(booking.startAt);
    const endAt = this.formatDate(booking.endAt);
    const titleSection = booking.title
      ? `<p><strong>Titel:</strong> ${this.escapeHtml(booking.title)}</p>`
      : '';
    const descriptionSection = booking.description
      ? `<p><strong>Beschreibung:</strong> ${this.escapeHtml(booking.description).replace(/\n/g, '<br/>')}</p>`
      : '';
    const reasonSection = reason
      ? `<p><strong>Grund:</strong> ${this.escapeHtml(reason)}</p>`
      : '';
    const conflictHint = booking.isOverbooked
      ? '<p style="color:#b45309;"><strong>Hinweis:</strong> Diese Buchung betrifft einen konfliktbehafteten Zeitraum.</p>'
      : '';

    return `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p><strong>Raum:</strong> ${this.escapeHtml(booking.room.name)}</p>
        <p><strong>Beginn:</strong> ${startAt}</p>
        <p><strong>Ende:</strong> ${endAt}</p>
        <p><strong>Status:</strong> ${booking.status}</p>
        ${titleSection}
        ${descriptionSection}
        ${reasonSection}
        ${conflictHint}
      </div>
    `;
  }

  private buildOccurrencesTable(bookings: Booking[]) {
    if (bookings.length === 0) {
      return '<p><em>Keine Termine.</em></p>';
    }
    const rows = bookings
      .map(
        (b) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${this.formatDate(b.startAt)}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${this.formatDate(b.endAt)}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${b.status}</td>
        </tr>`,
      )
      .join('');
    return `
      <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;">
        <thead>
          <tr style="background:#e2e8f0;">
            <th style="padding:8px;text-align:left;">Beginn</th>
            <th style="padding:8px;text-align:left;">Ende</th>
            <th style="padding:8px;text-align:left;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private wrapHtml(headline: string, message: string, detailsHtml: string) {
    const link = `${this.appUrl}`;
    return `
      <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#0f172a;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8f0;">
          <h2 style="margin:0 0 12px 0;color:#111827;">${headline}</h2>
          <p style="margin:0 0 20px 0;color:#334155;">${message}</p>
          ${detailsHtml}
          <p style="margin-top:22px;">
            <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;">
              Zur Raumbuchung
            </a>
          </p>
        </div>
      </div>
    `;
  }

  private async send(to: string, subject: string, html: string) {
    if (!this.transporter) return;
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

  private recurrenceLabel(recurrence: string) {
    if (recurrence === 'DAILY') return 'Täglich';
    if (recurrence === 'WEEKLY') return 'Wöchentlich';
    if (recurrence === 'MONTHLY') return 'Monatlich';
    return recurrence;
  }

  private escapeHtml(text: string) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private formatDate(value: Date) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(value);
  }
}
