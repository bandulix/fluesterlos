import { describe, expect, it } from "vitest";
import { bid, closeEvent, createOpenEvent, freshApp, hostCookie, joinGuest, multipart, ph, PNG_1PX } from "./helpers.js";

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
    expect(project.copyKey).toBe("school");
    expect(project.countsAuction).toBe(true);
    expect(project.photoUrl).toBeNull();
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

  it("adds awarded lots to the building total, ignores an open leading bid, and serves uploaded photos", async () => {
    const app = await freshApp();
    const cookie = await hostCookie(app);
    const { code, eventId, items } = await createOpenEvent(app, cookie, [
      { title: "Jersey", startingBid: 1000, minIncrement: 100 },
      { title: "Vase", startingBid: 2000, minIncrement: 100, buyNow: 8000 },
    ]);
    const seeded = await app.inject({ method: "POST", url: `/api/host/events/${code}/projects/example`, headers: { cookie } });
    const project = seeded.json().live.projects[0];
    expect(project.gewerke.map((g: { copyKey: string }) => g.copyKey)).toEqual([
      "roof", "shell", "windows", "furniture", "washrooms", "electrics",
    ]);

    const guest = await joinGuest(app, code, ph(4), "Otto");
    expect((await bid(app, code, guest.token, items[0].id, 1500)).statusCode).toBe(200);
    const open = await app.inject({ method: "GET", url: `/api/events/${code}` });
    expect(open.json().projects[0].auctionRaised).toBe(0);
    expect(open.json().projects[0].raised).toBe(0);

    expect((await bid(app, code, guest.token, items[1].id, 8000)).statusCode).toBe(200);
    const afterBuy = await app.inject({ method: "GET", url: `/api/events/${code}` });
    expect(afterBuy.json().projects[0].auctionRaised).toBe(8000);
    expect(afterBuy.json().projects[0].auctionLots).toBe(1);
    expect(afterBuy.json().projects[0].pledged).toBe(0);
    expect(afterBuy.json().projects[0].gewerke.every((g: { raised: number }) => g.raised === 0)).toBe(true);

    await closeEvent(eventId);
    const closed = await app.inject({ method: "GET", url: `/api/events/${code}` });
    expect(closed.json().projects[0].auctionRaised).toBe(9500);
    expect(closed.json().projects[0].auctionLots).toBe(2);
    expect(closed.json().projects[0].raised).toBe(9500);
    expect(closed.json().projects[0].pledged).toBe(0);

    const mp = multipart({}, [{ field: "file", filename: "school.png", type: "image/png", content: PNG_1PX }]);
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/projects/${project.id}/photo`,
      headers: { cookie, "content-type": mp.contentType },
      payload: mp.payload,
    });
    expect(uploaded.statusCode).toBe(200);
    const photoUrl = uploaded.json().live.projects[0].photoUrl as string;
    expect(photoUrl).toContain(`/projects/${project.id}/photo`);
    const photo = await app.inject({ method: "GET", url: photoUrl.split("?")[0] });
    expect(photo.statusCode).toBe(200);
    expect(String(photo.headers["content-type"])).toContain("image/png");

    const gewerkId = project.gewerke[0].id as string;
    const trade = multipart({}, [{ field: "file", filename: "roof.png", type: "image/png", content: PNG_1PX }]);
    const tradeUpload = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/gewerke/${gewerkId}/photo`,
      headers: { cookie, "content-type": trade.contentType },
      payload: trade.payload,
    });
    expect(tradeUpload.statusCode).toBe(200);
    expect(tradeUpload.json().live.projects[0].gewerke[0].photoUrl).toContain(`/gewerke/${gewerkId}/photo`);

    const again = await app.inject({ method: "POST", url: `/api/host/events/${code}/projects/example`, headers: { cookie } });
    expect(again.json().created).toBe(false);
    expect(again.json().live.projects).toHaveLength(1);
    await app.close();
  });

  it("hides a private project pledge and ranks a public name without the amount until asked", async () => {
    const app = await freshApp();
    const cookie = await hostCookie(app);
    const { code } = await createOpenEvent(app, cookie, [{ title: "Jersey", startingBid: 1000, minIncrement: 100 }]);
    const seeded = await app.inject({ method: "POST", url: `/api/host/events/${code}/projects/example`, headers: { cookie } });
    const project = seeded.json().live.projects[0];
    const guest = await joinGuest(app, code, ph(5), "Anna");
    const roof = project.gewerke[0].id as string;
    const quiet = await app.inject({
      method: "POST",
      url: `/api/events/${code}/gewerke/${roof}/pledges`,
      headers: { "x-guest-token": guest.token },
      payload: { mode: "partial", amount: 1000 },
    });
    expect(quiet.statusCode).toBe(200);
    expect(quiet.json().pledge.anonymous).toBe(true);
    const hidden = quiet.json().live;
    expect(JSON.stringify(hidden.projects)).not.toContain("Anna");
    expect(hidden.projects[0].gewerke[0].anonymousGifts).toBe(1);
    expect(hidden.projects[0].gewerke[0].donors).toEqual([]);
    expect(hidden.topDonors.some((d: { name: string }) => d.name === "Anna")).toBe(false);

    const desks = project.gewerke[3].id as string;
    const named = await app.inject({
      method: "POST",
      url: `/api/events/${code}/gewerke/${desks}/pledges`,
      headers: { "x-guest-token": guest.token },
      payload: { mode: "partial", amount: 5000, namedPublicly: true, publicName: "The Müller Family", showAmount: false },
    });
    expect(named.statusCode).toBe(200);
    const listed = named.json().live.projects[0];
    expect(listed.publicDonors[0]).toEqual({ name: "The Müller Family", amount: null });
    expect(JSON.stringify(listed)).not.toContain("Anna");
    const rank = named.json().live.topDonors.find((d: { name: string }) => d.name === "The Müller Family");
    expect(rank?.amount).toBeNull();

    const lena = await joinGuest(app, code, ph(6), "Lena");
    const wash = project.gewerke[4].id as string;
    const shown = await app.inject({
      method: "POST",
      url: `/api/events/${code}/gewerke/${wash}/pledges`,
      headers: { "x-guest-token": lena.token },
      payload: { mode: "partial", amount: 2000, namedPublicly: true, publicName: "Lena Berger", showAmount: true },
    });
    const ranked = shown.json().live.projects[0].publicDonors;
    expect(ranked).toEqual([
      { name: "The Müller Family", amount: null },
      { name: "Lena Berger", amount: 2000 },
    ]);
    expect(shown.json().live.topDonors.find((d: { name: string }) => d.name === "Lena Berger")?.amount).toBe(2000);
    const hostView = await app.inject({ method: "GET", url: `/api/host/events/${code}/projects`, headers: { cookie } });
    const pledges = hostView.json().projects[0].gewerke[0].pledges;
    expect(pledges[0].guestName).toBe("Anna");
    expect(pledges[0].anonymous).toBe(true);
    await app.close();
  });
});
