import { pool } from "./db.js";
import { money } from "./auction.js";

export type GewerkInput = {
  title: string;
  description?: string;
  targetAmount: number;
  sortOrder?: number;
  placeholder?: boolean;
};

export type ProjectInput = {
  title: string;
  description?: string;
  sortOrder?: number;
  placeholder?: boolean;
};

/** Demo school. Every figure is a placeholder, not a fundraising target. */
export const SCHOOL_PROJECT = {
  title: "Schulgebäude",
  description:
    "A school building funded trade by trade. Every amount on this project is a demo placeholder, not a real target.",
  gewerke: [
    { title: "Dach", description: "Roof structure and covering.", targetAmount: 450_000 },
    { title: "Rohbau", description: "The structural shell of the school.", targetAmount: 800_000 },
    { title: "Fenster", description: "Windows and frames for the classrooms.", targetAmount: 220_000 },
    { title: "Möbel", description: "Desks, chairs, and shelves.", targetAmount: 180_000 },
    { title: "Sanitär", description: "Washrooms and plumbing.", targetAmount: 150_000 },
    { title: "Elektro", description: "Lighting and power for the classrooms.", targetAmount: 160_000 },
  ],
};

export function photoUrl(code: string, kind: "projects" | "gewerke", id: string, stored: string | null): string | null {
  if (!stored) return null;
  if (/^https?:\/\//i.test(stored)) return stored;
  return `/api/events/${code}/${kind}/${id}/photo?v=${encodeURIComponent(stored.split("/").pop() ?? "")}`;
}

export function progress(target: number, raised: number) {
  const goal = money(target);
  const got = money(raised);
  const remaining = money(Math.max(0, goal - got));
  const percent = goal > 0 ? Math.min(100, Math.round((got / goal) * 1000) / 10) : 0;
  return { target: goal, raised: got, remaining, percent, funded: goal > 0 && remaining <= 0 };
}

type GiftRow = { gewerk_id: string; amount: string; guest_name: string; created_at: Date };

export async function listPublicProjects(eventId: string, code: string) {
  const projects = await pool.query(
    `SELECT id, title, description, photo_url, sort_order, placeholder
     FROM projects WHERE event_id = $1 ORDER BY sort_order, created_at`,
    [eventId],
  );
  if (!projects.rows.length) return [];
  const ids = projects.rows.map((p) => p.id as string);
  const gewerke = await pool.query(
    `SELECT id, project_id, title, description, photo_url, target_amount, sort_order, placeholder
     FROM gewerke WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order, created_at`,
    [ids],
  );
  const gifts = await pool.query(
    `SELECT pl.gewerk_id, pl.amount, g.name AS guest_name, pl.created_at
     FROM project_pledges pl
     JOIN guests g ON g.id = pl.guest_id
     JOIN gewerke w ON w.id = pl.gewerk_id
     WHERE w.project_id = ANY($1::uuid[]) AND pl.payment_status <> 'void'
     ORDER BY pl.created_at`,
    [ids],
  );
  const byGewerk = new Map<string, GiftRow[]>();
  for (const row of gifts.rows as GiftRow[]) {
    const list = byGewerk.get(row.gewerk_id) ?? [];
    list.push(row);
    byGewerk.set(row.gewerk_id, list);
  }
  return projects.rows.map((p) => {
    const trades = gewerke.rows.filter((g) => g.project_id === p.id).map((g) => {
      const mine = byGewerk.get(g.id as string) ?? [];
      const raised = mine.reduce((sum, gift) => sum + money(gift.amount), 0);
      const bar = progress(money(g.target_amount), raised);
      return {
        id: g.id as string,
        title: g.title as string,
        description: g.description as string,
        photoUrl: photoUrl(code, "gewerke", g.id as string, g.photo_url as string | null),
        sortOrder: g.sort_order as number,
        placeholder: Boolean(g.placeholder),
        ...bar,
        donorCount: mine.length,
        donors: mine.map((gift) => ({ name: gift.guest_name, amount: money(gift.amount) })),
      };
    });
    const target = trades.reduce((sum, t) => sum + t.target, 0);
    const raised = trades.reduce((sum, t) => sum + t.raised, 0);
    const donors = new Set(trades.flatMap((t) => t.donors.map((d) => d.name)));
    return {
      id: p.id as string,
      title: p.title as string,
      description: p.description as string,
      photoUrl: photoUrl(code, "projects", p.id as string, p.photo_url as string | null),
      sortOrder: p.sort_order as number,
      placeholder: Boolean(p.placeholder),
      ...progress(target, raised),
      donorCount: donors.size,
      gewerke: trades,
    };
  });
}

export async function hostProjectBundle(eventId: string) {
  const projects = await pool.query(
    `SELECT id, title, description, photo_url, sort_order, placeholder
     FROM projects WHERE event_id = $1 ORDER BY sort_order, created_at`,
    [eventId],
  );
  const ids = projects.rows.map((p) => p.id as string);
  const gewerke = ids.length
    ? await pool.query(
        `SELECT id, project_id, title, description, photo_url, target_amount, sort_order, placeholder
         FROM gewerke WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order, created_at`,
        [ids],
      )
    : { rows: [] };
  const gifts = ids.length
    ? await pool.query(
        `SELECT pl.id, pl.gewerk_id, pl.amount, pl.kind, pl.payment_status, pl.payment_provider, pl.payment_ref,
                pl.created_at, g.id AS guest_id, g.name AS guest_name, g.phone AS guest_phone
         FROM project_pledges pl
         JOIN guests g ON g.id = pl.guest_id
         JOIN gewerke w ON w.id = pl.gewerk_id
         WHERE w.project_id = ANY($1::uuid[])
         ORDER BY pl.created_at`,
        [ids],
      )
    : { rows: [] };
  return {
    projects: projects.rows.map((p) => ({
      id: p.id as string,
      title: p.title as string,
      description: p.description as string,
      sortOrder: p.sort_order as number,
      placeholder: Boolean(p.placeholder),
      hasPhoto: Boolean(p.photo_url),
      gewerke: gewerke.rows
        .filter((g) => g.project_id === p.id)
        .map((g) => {
          const rows = gifts.rows.filter((gift) => gift.gewerk_id === g.id && gift.payment_status !== "void");
          const raised = rows.reduce((sum, gift) => sum + money(gift.amount), 0);
          return {
            id: g.id as string,
            title: g.title as string,
            description: g.description as string,
            targetAmount: money(g.target_amount),
            sortOrder: g.sort_order as number,
            placeholder: Boolean(g.placeholder),
            hasPhoto: Boolean(g.photo_url),
            ...progress(money(g.target_amount), raised),
            pledges: gifts.rows
              .filter((gift) => gift.gewerk_id === g.id)
              .map((gift) => ({
                id: gift.id as string,
                guestId: gift.guest_id as string,
                guestName: gift.guest_name as string,
                guestPhone: (gift.guest_phone as string | null) ?? null,
                amount: money(gift.amount),
                kind: gift.kind as "partial" | "full",
                paymentStatus: gift.payment_status as string,
                paymentProvider: (gift.payment_provider as string | null) ?? null,
                paymentRef: (gift.payment_ref as string | null) ?? null,
                createdAt: new Date(gift.created_at as Date).toISOString(),
              })),
          };
        }),
    })),
  };
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { statusCode: status });
}

export async function createProject(eventId: string, input: ProjectInput) {
  const sort = await pool.query("SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM projects WHERE event_id = $1", [eventId]);
  const { rows } = await pool.query(
    `INSERT INTO projects (event_id, title, description, sort_order, placeholder)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [eventId, input.title.trim(), input.description?.trim() ?? "", input.sortOrder ?? (sort.rows[0].n as number) + 1, input.placeholder !== false],
  );
  return rows[0].id as string;
}

export async function updateProject(eventId: string, projectId: string, input: Partial<ProjectInput>) {
  const { rowCount } = await pool.query(
    `UPDATE projects SET
       title = COALESCE($3, title),
       description = COALESCE($4, description),
       sort_order = COALESCE($5, sort_order),
       placeholder = COALESCE($6, placeholder)
     WHERE id = $1 AND event_id = $2`,
    [
      projectId,
      eventId,
      input.title?.trim() || null,
      input.description === undefined ? null : input.description.trim(),
      input.sortOrder ?? null,
      input.placeholder ?? null,
    ],
  );
  if (!rowCount) throw httpError(404, "Project not found");
}

export async function deleteProject(eventId: string, projectId: string) {
  const { rowCount } = await pool.query("DELETE FROM projects WHERE id = $1 AND event_id = $2", [projectId, eventId]);
  if (!rowCount) throw httpError(404, "Project not found");
}

export async function createGewerk(eventId: string, projectId: string, input: GewerkInput) {
  const project = await pool.query("SELECT id FROM projects WHERE id = $1 AND event_id = $2", [projectId, eventId]);
  if (!project.rows[0]) throw httpError(404, "Project not found");
  if (!(input.targetAmount > 0)) throw httpError(400, "Target amount must be above zero");
  const sort = await pool.query("SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM gewerke WHERE project_id = $1", [projectId]);
  const { rows } = await pool.query(
    `INSERT INTO gewerke (project_id, title, description, target_amount, sort_order, placeholder)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      projectId,
      input.title.trim(),
      input.description?.trim() ?? "",
      money(input.targetAmount),
      input.sortOrder ?? (sort.rows[0].n as number) + 1,
      input.placeholder !== false,
    ],
  );
  return rows[0].id as string;
}

export async function updateGewerk(eventId: string, gewerkId: string, input: Partial<GewerkInput>) {
  if (input.targetAmount !== undefined && !(input.targetAmount > 0)) throw httpError(400, "Target amount must be above zero");
  const { rowCount } = await pool.query(
    `UPDATE gewerke g SET
       title = COALESCE($3, g.title),
       description = COALESCE($4, g.description),
       target_amount = COALESCE($5, g.target_amount),
       sort_order = COALESCE($6, g.sort_order),
       placeholder = COALESCE($7, g.placeholder)
     FROM projects p
     WHERE g.id = $1 AND g.project_id = p.id AND p.event_id = $2`,
    [
      gewerkId,
      eventId,
      input.title?.trim() || null,
      input.description === undefined ? null : input.description.trim(),
      input.targetAmount === undefined ? null : money(input.targetAmount),
      input.sortOrder ?? null,
      input.placeholder ?? null,
    ],
  );
  if (!rowCount) throw httpError(404, "Gewerk not found");
}

export async function deleteGewerk(eventId: string, gewerkId: string) {
  const { rowCount } = await pool.query(
    `DELETE FROM gewerke g USING projects p
     WHERE g.id = $1 AND g.project_id = p.id AND p.event_id = $2`,
    [gewerkId, eventId],
  );
  if (!rowCount) throw httpError(404, "Gewerk not found");
}

export async function seedSchoolProject(eventId: string) {
  const existing = await pool.query(
    "SELECT id FROM projects WHERE event_id = $1 AND title = $2",
    [eventId, SCHOOL_PROJECT.title],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id as string, created: false };
  const id = await createProject(eventId, {
    title: SCHOOL_PROJECT.title,
    description: SCHOOL_PROJECT.description,
    placeholder: true,
  });
  for (let i = 0; i < SCHOOL_PROJECT.gewerke.length; i++) {
    const g = SCHOOL_PROJECT.gewerke[i];
    await createGewerk(eventId, id, { ...g, sortOrder: i, placeholder: true });
  }
  return { id, created: true };
}

export async function placeGewerkPledge(opts: {
  eventId: string;
  gewerkId: string;
  guestId: string;
  mode: "full" | "partial";
  amount?: number;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gewerk = await client.query(
      `SELECT g.id, g.target_amount
       FROM gewerke g JOIN projects p ON p.id = g.project_id
       WHERE g.id = $1 AND p.event_id = $2
       FOR UPDATE`,
      [opts.gewerkId, opts.eventId],
    );
    if (!gewerk.rows[0]) throw httpError(404, "Gewerk not found");
    const raisedRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS raised FROM project_pledges
       WHERE gewerk_id = $1 AND payment_status <> 'void'`,
      [opts.gewerkId],
    );
    const bar = progress(money(gewerk.rows[0].target_amount), money(raisedRes.rows[0].raised));
    if (bar.funded) throw httpError(409, "This trade is already funded");
    let amount = opts.mode === "full" ? bar.remaining : money(opts.amount ?? 0);
    if (!(amount > 0)) throw httpError(400, "Enter an amount above zero");
    if (amount > bar.remaining + 0.001) throw httpError(400, "That is more than the amount still open");
    amount = money(Math.min(amount, bar.remaining));
    const kind = amount + 0.001 >= bar.remaining ? "full" : "partial";
    const inserted = await client.query(
      `INSERT INTO project_pledges (gewerk_id, guest_id, amount, kind, payment_status)
       VALUES ($1, $2, $3, $4, 'recorded')
       RETURNING id, amount, kind, payment_status, payment_provider, payment_ref`,
      [opts.gewerkId, opts.guestId, amount, kind],
    );
    await client.query("COMMIT");
    const row = inserted.rows[0];
    return {
      id: row.id as string,
      amount: money(row.amount),
      kind: row.kind as "partial" | "full",
      paymentStatus: row.payment_status as string,
      paymentProvider: (row.payment_provider as string | null) ?? null,
      paymentRef: (row.payment_ref as string | null) ?? null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function myProjectPledges(eventId: string, guestId: string) {
  const { rows } = await pool.query(
    `SELECT pl.gewerk_id, COALESCE(SUM(pl.amount), 0) AS amount
     FROM project_pledges pl
     JOIN gewerke g ON g.id = pl.gewerk_id
     JOIN projects p ON p.id = g.project_id
     WHERE p.event_id = $1 AND pl.guest_id = $2 AND pl.payment_status <> 'void'
     GROUP BY pl.gewerk_id`,
    [eventId, guestId],
  );
  return rows.map((r) => ({ gewerkId: r.gewerk_id as string, amount: money(r.amount) }));
}
