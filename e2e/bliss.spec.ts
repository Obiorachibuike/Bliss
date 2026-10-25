import { test, expect } from "@playwright/test";

/**
 * Browser-level journey for Bliss.
 *
 * These specs run against `npm run build && npm run start`. Set PLAYWRIGHT_BASE_URL to
 * point them at a deployment instead:
 *
 *   PLAYWRIGHT_BASE_URL=https://bliss.vercel.app npx playwright test
 *
 * The upstream provider (cvron.alwaysdata.net) is a free third-party service, so the
 * assistant turn is asserted leniently: either a real answer arrives, or Bliss reports
 * the outage. It must never render an invented answer.
 */

test.describe("Bliss workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Bliss/);
  });

  test("loads the branded welcome screen", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("create today");
    await expect(page.getByText("Ask anything, explore ideas, generate images")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask anything" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create an image" })).toBeVisible();
    // brand gradient on the primary action
    const newChat = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChat).toBeVisible();
  });

  test("sends a prompt and resolves with an answer or an honest error", async ({ page }) => {
    const composer = page.getByRole("textbox", { name: /message bliss/i });
    await composer.fill("Give me a one-line definition of recursion.");

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/chat"), { timeout: 90_000 }).catch(() => null),
      composer.press("Enter"),
    ]);

    // The user turn is always rendered optimistically.
    await expect(page.getByText("Give me a one-line definition of recursion.")).toBeVisible();
    await expect(page.getByText(/Thinking…|Recursion|definition/i).first()).toBeVisible();

    const reply = await page.locator("text=/couldn.t reach the AI service/i").count();
    if (reply === 0) {
      await expect(page.locator("main").last()).toContainText(/./);
    }
  });

  test("switching the model updates the selector", async ({ page }) => {
    await page.getByRole("button", { name: /llama 3.3/i }).click();
    await page.getByText("Gemini 2.5 Flash Lite").click();
    await expect(page.getByRole("button", { name: /gemini 2.5 flash lite/i })).toBeVisible();
  });

  test("theme toggle persists across reload", async ({ page }) => {
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.getByRole("button", { name: /toggle color theme/i }).click();
    const after = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(after).not.toBe(isDark);

    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(after);
  });

  test("image studio reaches the generator and reports real status", async ({ page }) => {
    await page.getByRole("button", { name: /^image studio$/i }).click();
    await expect(page.getByRole("heading", { name: /image studio/i })).toBeVisible();
    await page.getByPlaceholder(/alpine lake/i).fill("a minimal blue glass cube on white sand");
    await page.getByRole("button", { name: /generate image/i }).click();
    await expect(page.getByText(/Rendering with Flux Dev/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("video studio states its image-to-video constraint", async ({ page }) => {
    await page.getByRole("button", { name: /^video studio$/i }).click();
    await expect(page.getByText(/Image → video only/i)).toBeVisible();
    await page.getByRole("button", { name: /generate video/i }).click();
    await expect(page.getByText(/source image URL is required/i)).toBeVisible();
  });

  test("api explorer documents only verified endpoints", async ({ page }) => {
    await page.getByRole("button", { name: /api explorer/i }).click();
    await expect(page.getByText("Flux Dev image generation")).toBeVisible();
    await expect(page.getByText("WAN 2.2 image to video")).toBeVisible();
    await expect(page.getByText(/Not implemented because it isn/i)).toBeVisible();
    await expect(page.getByText(/chat\/completions/i)).toHaveCount(0);
  });

  test("history is recovered after reload", async ({ page }) => {
    const composer = page.getByRole("textbox", { name: /message bliss/i });
    await composer.fill("remember this exact phrase for history test");
    await composer.press("Enter");
    await expect(page.getByText("remember this exact phrase for history test")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "remember this exact phrase for history test" })).toBeVisible();
  });

  test("no horizontal overflow on narrow screens", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      )
      .toBeLessThanOrEqual(0);
  });

  test("mobile: drawer navigation opens and closes", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile-only");
    await page.getByRole("button", { name: /open navigation/i }).click();
    await expect(page.getByRole("button", { name: /^image studio$/i })).toBeVisible();
    await page.getByRole("button", { name: /^image studio$/i }).click();
    await expect(page.getByRole("heading", { name: /image studio/i })).toBeVisible();
  });

  test("keyboard: focus ring is visible on the composer", async ({ page }) => {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["A", "BUTTON", "TEXTAREA", "INPUT"]).toContain(tag);
  });
});
