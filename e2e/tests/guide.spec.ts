import { expect, test } from "@playwright/test";
import { expectVideoPlaying, seedLocalStorage } from "./support.ts";

test.describe("guide", () => {
  test("favourites get rows and the current programme, and Watch opens the channel", async ({ page }) => {
    await seedLocalStorage(page, { "freetv:favorites": JSON.stringify(["BBCNews.uk", "AlJazeera.qa"]) });
    await page.goto("/guide");

    await expect(page.getByRole("heading", { name: "TV guide" })).toBeVisible();
    await expect(page.getByTitle("BBC News", { exact: true })).toBeVisible();
    await expect(page.getByTitle("Al Jazeera", { exact: false }).first()).toBeVisible();

    // The fixture guide puts "BBC News at Ten" on air from 30 minutes ago to 30 minutes ahead.
    const programme = page.getByTitle("BBC News at Ten", { exact: true }).first();
    await expect(programme).toBeVisible({ timeout: 15_000 });
    await programme.click();

    const dialog = page.getByRole("dialog", { name: "BBC News at Ten" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: "Watch" }).click();

    await expect(page).toHaveURL(/\/watch\/BBCNews\.uk$/);
    await expect(page.getByRole("heading", { name: "BBC News", level: 1 })).toBeVisible();
    await expectVideoPlaying(page);
  });
});
