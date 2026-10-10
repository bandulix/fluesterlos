export type SentMail = { to: string; subject: string; text: string; attachments?: unknown[] };

export const mailbox = {
  smtp: true,
  sent: [] as SentMail[],
  reset() {
    this.smtp = true;
    this.sent.length = 0;
  },
};
