import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR || "/data";

export async function ensureDataDirs() {
  await mkdir(path.join(DATA_DIR, "vouchers"), { recursive: true });
  await mkdir(path.join(DATA_DIR, "payslips"), { recursive: true });
  await mkdir(path.join(DATA_DIR, "qr"), { recursive: true });
}

function safeExt(filename: string, allowed: string[], fallback: string) {
  const ext = path.extname(filename || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  return allowed.includes(ext) ? ext : fallback;
}

/** Returns relative path under DATA_DIR (posix-style). */
export async function saveUpload(
  kind: "vouchers" | "payslips" | "qr",
  originalName: string,
  buffer: Buffer,
  idHint?: string,
): Promise<string> {
  await ensureDataDirs();
  const allowed =
    kind === "vouchers"
      ? [".pdf"]
      : [".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"];
  const fallback = kind === "vouchers" ? ".pdf" : ".jpg";
  const ext = safeExt(originalName, allowed, fallback);
  const id = idHint || randomBytes(12).toString("hex");
  const rel = path.posix.join(kind, `${id}${ext}`);
  const abs = resolveDataPath(rel);
  await writeFile(abs, buffer);
  return rel;
}

export function resolveDataPath(rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..") || path.isAbsolute(cleaned)) {
    throw Object.assign(new Error("Invalid path"), { statusCode: 400 });
  }
  const abs = path.resolve(DATA_DIR, cleaned);
  const root = path.resolve(DATA_DIR);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw Object.assign(new Error("Invalid path"), { statusCode: 400 });
  }
  return abs;
}

export async function readDataFile(rel: string): Promise<Buffer> {
  const abs = resolveDataPath(rel);
  await access(abs, constants.R_OK);
  return readFile(abs);
}

export function contentTypeFor(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
