import type { FastifyRequest } from "fastify";
import { pool } from "./db.js";

export async function readMultipartFile(req: FastifyRequest) {
  const file = await req.file();
  if (!file) return null;
  const buffer = await file.toBuffer();
  return { filename: file.filename, mimetype: file.mimetype, buffer };
}

export async function getHostSettings() {
  const { rows } = await pool.query(
    "SELECT promptpay_id, payee_name, qr_image_path FROM host_settings WHERE id = 1",
  );
  const row = rows[0] as
    | { promptpay_id: string | null; payee_name: string | null; qr_image_path: string | null }
    | undefined;
  return {
    promptpay_id: row?.promptpay_id || process.env.PROMPTPAY_ID || null,
    payee_name: row?.payee_name || process.env.PROMPTPAY_PAYEE_NAME || null,
    qr_image_path: row?.qr_image_path ?? null,
  };
}
