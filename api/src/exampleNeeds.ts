import { pool } from "./db.js";

/**
 * Sample Fund-a-Need items for the Thai.GER charity. They are example data:
 * `example` is true, and each description says so. Safe to insert more than once.
 */
export const EXAMPLE_NEEDS = [
  {
    title: "A playground for the school",
    beneficiary: "Thai.GER charity — the school",
    description:
      "Example data for the Thai.GER Supporters gala. A playground so the children have a safe place to play.",
    targetAmount: 150000,
    minPledge: 500,
    suggestedAmounts: [1000, 5000, 10000, 25000],
    unitLabel: null as string | null,
    unitAmount: null as number | null,
    capAtTarget: false,
  },
  {
    title: "School uniforms for 30 children",
    beneficiary: "Thai.GER charity — the students",
    description:
      "Example data for the Thai.GER Supporters gala. One uniform is ฿800. Fund one, or a whole class of 30.",
    targetAmount: 24000,
    minPledge: 800,
    suggestedAmounts: [800, 2400, 8000, 24000],
    unitLabel: "uniform",
    unitAmount: 800,
    capAtTarget: false,
  },
  {
    title: "A year of lunches for one class",
    beneficiary: "Thai.GER charity — one class",
    description:
      "Example data for the Thai.GER Supporters gala. Lunch for a class, every school day for a year.",
    targetAmount: 36000,
    minPledge: 500,
    suggestedAmounts: [1000, 5000, 10000, 25000],
    unitLabel: null as string | null,
    unitAmount: null as number | null,
    capAtTarget: true,
  },
] as const;

/** Inserts any example needs this event does not already have. Returns how many were created. */
export async function insertExampleNeeds(eventId: string): Promise<number> {
  let created = 0;
  for (const n of EXAMPLE_NEEDS) {
    const exists = await pool.query(
      "SELECT 1 FROM needs WHERE event_id = $1 AND example = true AND title = $2",
      [eventId, n.title],
    );
    if (exists.rows[0]) continue;
    const sort = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM needs WHERE event_id = $1",
      [eventId],
    );
    await pool.query(
      `INSERT INTO needs
        (event_id, title, beneficiary, description, target_amount, min_pledge, suggested_amounts,
         unit_label, unit_amount, cap_at_target, sort_order, example)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,true)`,
      [
        eventId,
        n.title,
        n.beneficiary,
        n.description,
        n.targetAmount,
        n.minPledge,
        JSON.stringify(n.suggestedAmounts),
        n.unitLabel,
        n.unitAmount,
        n.capAtTarget,
        sort.rows[0].n,
      ],
    );
    created++;
  }
  return created;
}
