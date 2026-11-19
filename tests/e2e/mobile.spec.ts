import { expect, test } from "@playwright/test";

// Phone-sized play: every essential task works without horizontal page scrolling.

test("a phone player can begin, use the terminal and the Caesar Lab, and own a challenge", async ({ page, browser }) => {
  const other = await (await browser.newContext()).newPage();
  await other.goto("/create");
  await other.getByLabel("Team name").fill("Mobile Moths");
  await other.getByLabel("Your nickname").fill("Host");
  await other.getByRole("button", { name: "Create team" }).click();
  const code = (await other.locator("p.join-code").textContent())!.trim();

  await page.goto(`/join?code=${code}`);
  await page.getByLabel("Your nickname").fill("Phone");
  await page.getByRole("button", { name: "Join team" }).click();
  await page.getByRole("button", { name: "Begin the investigation" }).click();
  await expect(page.getByRole("heading", { name: "Challenges" })).toBeVisible();

  const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noHorizontalScroll()).toBe(true);

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const input = page.getByLabel("Terminal command");
  await input.fill("cat interviews/salma_nasser.txt");
  await input.press("Enter");
  await expect(page.locator(".term-screen")).toContainText("I was in the booth on my own.");
  expect(await noHorizontalScroll()).toBe(true);

  await page.getByRole("button", { name: "Caesar", exact: true }).click();
  await page.getByLabel("Input").fill("Khoor");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Shift up by one" }).click();
  await expect(page.locator(".lab-output")).toHaveText("Hello");
  expect(await noHorizontalScroll()).toBe(true);

  for (const tool of ["Timeline", "Cheat sheet", "Notes"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    expect(await noHorizontalScroll()).toBe(true);
  }

  await page.getByRole("button", { name: "Challenges", exact: true }).click();
  await page.getByRole("button", { name: /Moth/ }).click();
  await page.getByLabel("Flag for Moth").fill("FLAG{PROJECTION_ROOM_2350}");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("alertdialog", { name: "Owned: Moth" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await noHorizontalScroll()).toBe(true);

  await page.getByRole("link", { name: "Case file" }).click();
  await expect(page.getByRole("heading", { name: "Persons of interest" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Witnesses" })).toBeVisible();
  await expect(page.getByRole("img", { name: "No photo on file. Camera shy." })).toBeVisible();
  expect(await noHorizontalScroll()).toBe(true);

  await page.getByRole("button", { name: "Display settings" }).click();
  await expect(page.getByRole("dialog", { name: "Display settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
