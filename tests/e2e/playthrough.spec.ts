import { expect, test, type Browser, type Page } from "@playwright/test";

// A full team playthrough the way players would do it: terminal, Caesar Lab, flags, accusation.

async function newPlayer(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}

async function run(page: Page, cmd: string) {
  const input = page.getByLabel("Terminal command");
  await input.fill(cmd);
  await input.press("Enter");
  await expect(page.getByLabel("Terminal command")).toHaveValue("");
}

async function flag(page: Page, title: string, value: string) {
  const card = page.locator(".challenge", { has: page.getByRole("button", { name: new RegExp(title) }) });
  if (!(await card.getByLabel(`Flag for ${title}`).isVisible())) await card.getByRole("button", { name: new RegExp(title) }).click();
  await card.getByLabel(`Flag for ${title}`).fill(value);
  await card.getByRole("button", { name: "Submit" }).click();
}

async function owned(page: Page, title: string) {
  const overlay = page.getByRole("alertdialog", { name: `Owned: ${title}` });
  await expect(overlay).toBeVisible();
  await overlay.click();
  await expect(overlay).toHaveCount(0);
}

async function actOpens(page: Page, title: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Back to the investigation" }).click();
  await expect(dialog).toHaveCount(0);
}

test("a two-person team works the evidence act by act and closes the case", async ({ browser }) => {
  const ana = await newPlayer(browser);
  const errors: string[] = [];
  ana.on("pageerror", (e) => errors.push(e.message));

  await ana.goto("/");
  await expect(ana.getByRole("heading", { name: "Case 404" })).toBeVisible();
  await ana.getByRole("link", { name: "Create a team" }).click();
  await ana.getByLabel("Team name").fill("Playwright Owls");
  await ana.getByLabel("Your nickname").fill("Ana");
  await ana.getByRole("button", { name: "Create team" }).click();
  const code = (await ana.locator("p.join-code").textContent())!.trim();
  expect(code).toMatch(/^\w{4}-\w{4}-\w{4}$/);

  const ben = await newPlayer(browser);
  await ben.goto(`/join?code=${code}`);
  await ben.getByLabel("Your nickname").fill("Ben");
  await ben.getByRole("button", { name: "Join team" }).click();
  await expect(ben).toHaveURL(/\/team$/);

  await ana.getByRole("button", { name: "Go to team lobby" }).click();
  await expect(ana.getByText("Ben", { exact: true })).toBeVisible({ timeout: 10_000 });
  await ana.getByRole("button", { name: "Begin the investigation" }).click();
  await expect(ana).toHaveURL(/\/case$/);
  await expect(ana.getByRole("heading", { name: "Challenges" })).toBeVisible();

  // Act I is open; Acts II and III are sealed, titles withheld. No hints anywhere.
  await expect(ana.locator(".challenge")).toHaveCount(8);
  await expect(ana.locator(".challenge.locked")).toHaveCount(6);
  await expect(ana.getByRole("heading", { name: "The Meeting" })).toBeVisible();
  await expect(ana.getByText("Opens when both Act I challenges are owned.")).toBeVisible();
  await expect(ana.getByText(/hint/i)).toHaveCount(0);
  await run(ana, "ls");
  await expect(ana.locator(".term-screen")).not.toContainText("photobooth");

  // EV01: the Caesar Lab starts empty; the player pastes the line and turns the dial.
  await ana.getByRole("tab", { name: "Caesar Lab" }).click();
  await expect(ana.getByLabel("Input")).toHaveValue("");
  await ana.getByLabel("Input").fill("Yze zgpc epie. Xppe xp ty esp aczupnetzy czzx le 11:50. Nzxp lwzyp.");
  await ana.getByRole("slider").fill("11");
  await expect(ana.locator(".lab-output")).toHaveText("Not over text. Meet me in the projection room at 11:50. Come alone.");
  await flag(ana, "Moth", "FLAG{PROJECTION_ROOM_2349}");
  await expect(ana.getByText("Incorrect flag.")).toBeVisible();
  await flag(ana, "Moth", "flag{projection_room_2350}");
  await owned(ana, "Moth");

  // EV02: the door log posted to the staff channel. Owning it opens Act II.
  await ana.getByRole("tab", { name: "Terminal" }).click();
  await run(ana, "grep PROJ-EAST staff_channel/attachments/door_log.csv | tail -n 3");
  await expect(ana.locator(".term-screen")).toContainText("2026-10-31 23:49:03,PROJ-EAST,ENTRY,L07,GRANTED");
  await flag(ana, "The Door", "FLAG{L07_2349}");
  await expect(ana.getByText("Act II unlocked")).toBeVisible();
  await owned(ana, "The Door");
  await actOpens(ana, "Act II: The Booth");
  await expect(ana.locator(".term-screen")).toContainText("New evidence mounted under ~/case404");
  await expect(ana.locator(".challenge.locked")).toHaveCount(3);

  // EV03: the booth counted two people and saw one.
  await run(ana, "grep S27 photobooth/device.log");
  await expect(ana.locator(".term-screen")).toContainText("23:51:15 S27 SEAT_SENSOR occupants=2");
  await flag(ana, "Not in the Picture", "FLAG{S27_2352}");
  await owned(ana, "Not in the Picture");

  // EV05: only one export matches the hash sealed at intake. Owning a second Act II flag opens Act III.
  await run(ana, "sha256sum access_control/exports/*.csv; grep -A6 DER-404-01 intake/manifest.json");
  await run(ana, "diff staff_channel/attachments/door_log.csv access_control/exports/ACS-EXP-7731.csv");
  await expect(ana.locator(".term-screen")).toContainText("> 2026-10-31 23:55:26,PROJ-EAST,EXIT,A14,GRANTED");
  await flag(ana, "Two Copies", "FLAG{A14_2355}");
  await owned(ana, "Two Copies");
  await actOpens(ana, "Act III: The Angel");

  // EV04: the full thread, sliced with jq.
  await run(ana, "jq -r '.messages[-1].text' phones/nadia_haddad/messenger/lucien_moreau.json");
  await expect(ana.locator(".term-screen")).toContainText("I did not change them. Please keep this between us.");
  await flag(ana, "Cropped", "FLAG{I_DID_NOT_CHANGE_THEM}");
  await owned(ana, "Cropped");

  // EV06: the deleted thread is gone from the table but not from the file.
  await run(ana, "sqlite3 phones/salma_nasser/sms.db 'SELECT count(*) FROM message WHERE handle_id = 1'");
  await run(ana, "strings phones/salma_nasser/sms.db | grep 'photo booth'");
  await expect(ana.locator(".term-screen")).toContainText("keep him there till 11:55");
  await flag(ana, "Deleted", "FLAG{2355}");
  await owned(ana, "Deleted");

  // EV07: the feed copy has no EXIF; the original does.
  await run(ana, "exiftool -DateTimeOriginal social/originals/IMG_4471.jpg");
  await expect(ana.locator(".term-screen")).toContainText("Date/Time Original              : 2026:10:31 23:28:00");
  await flag(ana, "Halo, Delayed", "FLAG{2328}");
  await owned(ana, "Halo, Delayed");

  // EV08: the hidden backup.
  await run(ana, "ls -a finance");
  await expect(ana.locator(".term-screen")).toContainText(".backup");
  await run(ana, "diff finance/expenses_export.csv finance/.backup/ledger_2026-10-30.csv");
  await expect(ana.locator(".term-screen")).toContainText("BC-104-DUP");
  await flag(ana, "Clean Books", "FLAG{0412}");
  await owned(ana, "Clean Books");
  await expect(ana.getByText("8/8 owned · 130/130 pts")).toBeVisible();

  // The timeline strikes the forged door entry; the cheat sheet finds tools by task.
  await ana.getByRole("tab", { name: "Timeline" }).click();
  await expect(ana.locator(".timeline del")).toContainText("wristband L07");
  await expect(ana.locator(".timeline")).toContainText("badge A14 (Yasmine Mansour)");
  await ana.getByRole("tab", { name: "Cheat sheet" }).click();
  await ana.getByLabel("Find a command").fill("metadata");
  await expect(ana.locator(".cheatsheet")).toContainText("exiftool -DateTimeOriginal photo.jpg");

  // The teammate's board catches up on its own.
  await ben.goto("/case");
  await expect(ben.locator(".challenge.owned")).toHaveCount(8, { timeout: 10_000 });

  // Fast-close notes sync to the other participant, including after reconnect/refresh.
  await ana.getByRole("tab", { name: "Notes", exact: true }).click();
  await ana.getByLabel("New note", { exact: false }).fill("Shared finding");
  await ana.getByRole("button", { name: "Add note", exact: false }).click();
  await ana.getByRole("button", { name: "Edit “Shared finding”" }).click();
  await ana.getByLabel("Note", { exact: true }).fill("Saved before Done");
  await ana.getByRole("button", { name: "Done", exact: true }).click();
  await expect(ana.getByText("Saved before Done", { exact: true })).toBeVisible();
  await actOpens(ben, "Act III: The Angel");
  await ben.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(ben.getByText("Saved before Done", { exact: true })).toBeVisible({ timeout: 10_000 });
  await ana.context().setOffline(true);
  await ana.waitForTimeout(4500);
  await expect(ana.locator(".challenge.owned")).toHaveCount(8);
  await ana.context().setOffline(false);
  await ana.reload();
  await expect(ana.locator(".challenge.owned")).toHaveCount(8);
  await expect(ana.getByText("Saved before Done", { exact: true })).toBeVisible();

  // A wrong accusation costs 10 and says nothing about why.
  await ana.getByRole("link", { name: "Accuse" }).click();
  const who = ana.getByRole("group", { name: "Who killed Nadia?" });
  const helper = ana.getByRole("group", { name: "Did anyone help?" });
  await who.getByRole("radio", { name: "Lucien Moreau" }).check();
  await ana.getByRole("radio", { name: /keep a secret/ }).check();
  await ana.getByLabel("Evidence file 1").fill("staff_channel/attachments/fwd_0003.png");
  await ana.getByRole("button", { name: "File the accusation" }).click();
  await ana.getByRole("dialog").getByRole("button", { name: "Accuse" }).click();
  await expect(ana.getByText("The accusation doesn't hold up. One attempt left. (−10 pts)")).toBeVisible();

  await who.getByRole("radio", { name: "Yasmine Mansour" }).check();
  await ana.getByRole("radio", { name: /stolen fundraiser money/ }).check();
  await helper.getByRole("radio", { name: "Salma Nasser" }).check();
  await ana.getByLabel("Evidence file 1").fill("finance/.backup/ledger_2026-10-30.csv");
  await ana.getByLabel("Evidence file 2").fill("access_control/exports/ACS-EXP-7731.csv");
  await ana.getByRole("button", { name: "File the accusation" }).click();
  await expect(ana.getByRole("dialog")).toContainText("Helped by Salma Nasser");
  await ana.getByRole("dialog").getByRole("button", { name: "Accuse" }).click();
  await expect(ana).toHaveURL(/\/case\/result$/);
  await expect(ana.getByRole("heading", { name: "Case closed" })).toBeVisible();
  await expect(ana.getByText("Accomplice +15", { exact: false })).toBeVisible();
  await expect(ana.getByText(/Lucien never hurt anyone/)).toBeVisible();

  await ana.getByRole("link", { name: "Scoreboard" }).click();
  await expect(ana.getByRole("row", { name: /Playwright Owls/ })).toContainText("175");
  expect(errors).toEqual([]);
});

test("the practice room works before the clock starts", async ({ browser }) => {
  const page = await newPlayer(browser);
  await page.goto("/create");
  await page.getByLabel("Team name").fill("Practice Bats");
  await page.getByLabel("Your nickname").fill("Ana");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: "Go to team lobby" }).click();
  await page.getByRole("link", { name: "Open the practice room" }).click();
  await expect(page).toHaveURL(/\/team\/practice$/);
  await expect(page.getByText("Unscored · clock not running")).toBeVisible();

  await run(page, "ls");
  await expect(page.locator(".term-screen")).not.toContainText(".secret_note");
  await run(page, "ls -a");
  await run(page, "cat .secret_note");
  await expect(page.locator(".term-screen")).toContainText("The practice word is LANTERN");
  await run(page, "help exiftool");
  await expect(page.locator(".term-screen")).toContainText("Examples:");

  await page.getByLabel("Answer for Hidden in plain sight").fill("FLAG{LANTERN}");
  await page.locator(".challenge", { hasText: "Hidden in plain sight" }).getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("1/4 solved")).toBeVisible();

  await page.getByRole("tab", { name: "Cheat sheet" }).click();
  await expect(page.getByRole("heading", { name: "Comparing files and proving they're unchanged" })).toBeVisible();
  await page.getByRole("link", { name: "Lobby", exact: true }).click();
  await expect(page.getByRole("button", { name: "Begin the investigation" })).toBeVisible();
});
