import { test, expect } from "@playwright/test";

test("compact header switches plans and stays usable on narrow screens", async ({ page }) => {
  await page.request.post("/api/v1/workspaces", { data: {} });
  const first = await (await page.request.post("/api/v1/plans", { data: { example: true } })).json();
  const second = await (await page.request.post("/api/v1/plans", { data: { example: true } })).json();
  const title = "LongPlanNameWithoutSpacesForResponsiveHeaderVerification2026";
  await page.request.put(`/api/v1/plans/${second.id}`, {
    data: { expectedRevision: second.revision, document: { ...second.document, title } },
  });
  await page.goto(`/?plan=${first.id}`);
  await page.getByRole("button", { name: "切换方案", exact: true }).click();
  await page.getByText(title, { exact: true }).click();
  await expect(page.locator(".workspace-header h1")).toHaveText(title);
  await expect(page).toHaveURL(new RegExp(second.id));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "新建方案", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const heading = await page.locator(".workspace-identity").boundingBox();
    const actions = await page.locator(".workspace-actions").boundingBox();
    expect(heading && actions && (
      actions.x >= heading.x + heading.width - 1 ||
      actions.y >= heading.y + heading.height - 1
    )).toBeTruthy();
    await page.screenshot({ path: `test-results/header-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "结算设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "工作区设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "导出全部方案", exact: true })).toBeVisible();
});
