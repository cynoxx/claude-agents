import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../lib/config.js';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Sans SMTP configuré, les emails sont simplement journalisés. */
class LogMailer implements Mailer {
  sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
    if (process.env.NODE_ENV !== 'test') console.info(`[email] à ${to} : ${subject}`);
  }
}

class SmtpMailer implements Mailer {
  constructor(private transporter: Transporter) {}
  async send(to: string, subject: string, text: string) {
    await this.transporter.sendMail({ from: config.smtp.from, to, subject, text });
  }
}

export function createMailer(): Mailer {
  if (!config.smtp.host) return new LogMailer();
  return new SmtpMailer(
    nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    }),
  );
}

export { LogMailer };
