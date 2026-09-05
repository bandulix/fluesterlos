import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw Object.assign(new Error("SMTP is not configured (set SMTP_HOST)"), {
      statusCode: 503,
    });
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth:
      process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
  });
  return transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}) {
  const from =
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    "noreply@fluesterlos.local";
  const t = getTransporter();
  await t.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}
