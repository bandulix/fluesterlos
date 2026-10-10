import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://fluesterlos:fluesterlos@localhost:5432/fluesterlos_test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "fluesterlos-test-"));
process.env.BOOTSTRAP_TOKEN = "test-bootstrap-token";
process.env.PUBLIC_URL = "http://localhost:8080";
// Generous defaults; rate-limit tests build their own app with low limits.
process.env.RATE_LIMIT_JOIN_PER_MIN ??= "10000";
process.env.RATE_LIMIT_VERIFY_PER_10MIN ??= "10000";
process.env.RATE_LIMIT_BID_PER_10S ??= "10000";
process.env.RATE_LIMIT_LOGIN_PER_MIN ??= "10000";

// Capture outgoing mail instead of talking to SMTP.
vi.mock("../src/mail.js", async () => {
  const { mailbox } = await import("./mailbox.js");
  return {
    smtpConfigured: () => mailbox.smtp,
    sendMail: async (opts: { to: string; subject: string; text: string; attachments?: unknown[] }) => {
      mailbox.sent.push(opts);
    },
  };
});
