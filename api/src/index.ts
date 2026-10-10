import { migrate } from "./db.js";
import { ensureDataDirs } from "./storage.js";
import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp();
await migrate();
await ensureDataDirs();
await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`FluesterLos API on :${PORT}`);
