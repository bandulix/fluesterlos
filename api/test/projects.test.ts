import { describe, expect, it } from "vitest";
import { freshApp, hostCookie, createOpenEvent, joinGuest, ph } from "./helpers.js";

describe("project funding", () => {
  it("seeds a placeholder school, records a partial pledge and a full takeover, and keeps payment unset", async () => {
    const app = await freshApp();
    const cookie = await hostCookie(app);
    const { code } = await createOpenEvent(app, cookie, [{ title: "Jersey", startingBid: 1000, minIncrement: 100 }]);
    const seeded = await app.inject({ method: "POST", url: `/api/host/events/${code}/projects/example`, headers: { cookie } });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().created).toBe(true);
    const live = seeded.json().live;
    const project = live.projects[0];
    expect(project.title).toBe("Schulgebäude");
    expect(project.placeholder).toBe(true);
    expect(project.gewerke.map((g: { title: string }) => g.title)).toEqual(["Dach", "Rohbau", "Fenster", "Möbel", "Sanitär", "Elektro"]);
    expect(project.gewerke.every((g: { placeholder: boolean; target: number }) => g.placeholder && g.target > 0)).toBe(true);
    expect(JSON.stringify(live.projects)).not.toContain("phone");

    const guest = await joinGuest(app, code, ph(3), "Anna");
    const dach = project.gewerke[0] as { id: string; target: number; remaining: number };
    const partial = await app.inject({
      method: "POST",
      url: `/api/events/${code}/gewerke/${dach.id}/pledges`,
      headers: { "x-guest-token": guest.token },
      payload: { mode: "partial", amount: 50000 },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().pledge).toMatchObject({ kind: "partial", paymentStatus: "recorded", paymentProvider: null, paymentRef: null, amount: 50000 });

    const full = await app.inject({
      method: "POST",
      url: `/api/events/${code}/gewerke/${dach.id}/pledges`,
      headers: { "x-guest-token": guest.token },
      payload: { mode: "full" },
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().pledge.kind).toBe("full");
    expect(full.json().pledge.amount).toBe(dach.target - 50000);
    const after = full.json().live.projects[0].gewerke[0];
    expect(after.funded).toBe(true);
    expect(after.raised).toBe(dach.target);

    const over = await app.inject({
      method: "POST",
      url: `/api/events/${code}/gewerke/${dach.id}/pledges`,
      headers: { "x-guest-token": guest.token },
      payload: { mode: "partial", amount: 1 },
    });
    expect(over.statusCode).toBe(409);

    const hostView = await app.inject({ method: "GET", url: `/api/host/events/${code}/projects`, headers: { cookie } });
    const pledges = hostView.json().projects[0].gewerke[0].pledges;
    expect(pledges).toHaveLength(2);
    expect(pledges[0].guestPhone).toBe("+66810000003");
    expect(pledges.every((p: { paymentProvider: string | null }) => p.paymentProvider == null)).toBe(true);
    await app.close();
  });

  it("lets the owner invite an admin who can open the desk, and blocks that admin from inviting", async () => {
    const app = await freshApp();
    const cookie = await hostCookie(app);
    const invited = await app.inject({
      method: "POST",
      url: "/api/host/invites",
      headers: { cookie },
      payload: { email: "admin@example.org" },
    });
    expect(invited.statusCode).toBe(200);
    const acceptUrl = invited.json().invite.acceptUrl as string;
    const token = acceptUrl.split("/").pop() as string;
    const accepted = await app.inject({
      method: "POST",
      url: "/api/host/auth/accept-invite",
      payload: { token, password: "password123" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().user.role).toBe("admin");
    const adminCookie = (accepted.headers["set-cookie"] as string).split(";")[0];
    const events = await app.inject({ method: "GET", url: "/api/host/events", headers: { cookie: adminCookie } });
    expect(events.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url: "/api/host/invites",
      headers: { cookie: adminCookie },
      payload: { email: "other@example.org" },
    });
    expect(again.statusCode).toBe(403);
    await app.close();
  });
});
