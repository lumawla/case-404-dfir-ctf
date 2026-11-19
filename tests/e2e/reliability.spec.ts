import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("private recovery keeps the original browser valid when joining is closed", async ({ browser }) => {
  const original = await browser.newContext(), stranger = await browser.newContext(), recovered = await browser.newContext(), admin = await browser.newContext();
  try {
    const page = await original.newPage();
    await page.goto("/create");
    await page.getByLabel("Team name").fill("Recovery Browser Team"); await page.getByLabel("Your nickname").fill("Ana");
    await page.getByRole("button", { name: "Create team" }).click();
    const code = (await page.locator("p.join-code").textContent())!.trim();
    await page.getByRole("button", { name: "Go to team lobby" }).click();
    await page.getByText("My private recovery key", { exact: true }).click();
    await page.getByRole("button", { name: "Show my recovery key" }).click();
    const key = await page.getByLabel("My private recovery key", { exact: true }).inputValue();
    expect(key.length).toBeGreaterThan(20);
    expect((await stranger.request.post("/api/teams/join", { data: { code, nickname: "Ana" } })).status()).toBe(409);
    expect((await original.request.get("/api/me/team-state")).status()).toBe(200);
    await admin.request.post("/api/admin/login", { data: { token: "e2e-admin-token-123456" } });
    await admin.request.put("/api/admin/event", { data: { registrationOpen: false } });
    expect((await stranger.request.post("/api/teams/join", { data: { code, nickname: "Late" } })).status()).toBe(403);
    const other = await recovered.newPage(); await other.goto(`/join?code=${code}`);
    await other.getByLabel("Your nickname").fill("Ana");
    await other.getByText("Recover my existing membership").click();
    await other.getByLabel("Private recovery key", { exact: true }).fill(key);
    await other.getByRole("button", { name: "Join team" }).click(); await expect(other).toHaveURL(/\/team$/);
    await page.reload(); await expect(page.getByRole("heading", { name: "Recovery Browser Team" })).toBeVisible();
  } finally {
    await admin.request.put("/api/admin/event", { data: { registrationOpen: true } });
    await Promise.all([original.close(), stranger.close(), recovered.close(), admin.close()]);
  }
});

test("browser evidence requests reauthenticate after a session switch and PDFs stay viewable", async ({ page }) => {
  const answers = JSON.parse(readFileSync("private/organizer/answers.json", "utf8"));
  const meta = JSON.parse(readFileSync("content/evidence/meta.json", "utf8"));
  const created = await page.request.post("/api/teams", { data: { teamName: "Cache Browser Team", nickname: "Ana" } });
  const team = await created.json();
  const { request } = await import("@playwright/test");
  const mate = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await mate.post("/api/teams/join", { data: { code: team.joinCode, nickname: "Ben" } });
    await page.request.post("/api/case/start", { data: {} });
    for (const id of ["EV01", "EV02", "EV03", "EV05"]) expect((await page.request.post(`/api/case/challenges/${id}/submit`, { data: { answer: answers.flags[id] } })).ok()).toBe(true);
    const pdf = Object.keys(meta.files).find(p => p.endsWith(".pdf"))!;
    const document = await page.request.get(`/api/case/fs/raw?path=${encodeURIComponent(pdf)}`);
    expect(document.headers()["content-type"]).toBe("application/pdf");
    expect(document.headers()["content-disposition"]).toContain("inline");
    expect(document.headers()["cache-control"]).toBe("no-store");
    expect(document.headers()["content-security-policy"]).toContain("object-src 'self'");
    const image = Object.keys(meta.files).find(p => p.endsWith(".png"))!;
    const url = `/api/case/fs/raw?path=${encodeURIComponent(image)}`;
    const visible = await page.goto(url); expect(visible!.status()).toBe(200); expect(visible!.headers()["cache-control"]).toBe("no-store");
    await page.request.post("/api/teams", { data: { teamName: "Fresh Cache Browser Team", nickname: "New" } });
    const denied = await page.goto(url); expect(denied!.status()).toBe(409);
    await page.request.post("/api/me/logout", { data: {} });
    expect((await page.goto(url))!.status()).toBe(401);
  } finally { await mate.dispose(); }
});
