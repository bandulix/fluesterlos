import type { FastifyInstance } from "fastify";
import { ensureDataDirs } from "./storage.js";
import { registerInvoiceHostRoutes } from "./invoiceHostRoutes.js";
import { registerInvoiceGuestRoutes } from "./invoiceGuestRoutes.js";

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date };

export function registerInvoiceRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
    requireHost: (req: import("fastify").FastifyRequest) => Promise<unknown>;
  },
) {
  registerInvoiceHostRoutes(app, deps);
  registerInvoiceGuestRoutes(app, { codeOf: deps.codeOf, getEventByCode: deps.getEventByCode });
  void ensureDataDirs();
}
