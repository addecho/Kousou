import { test, expect } from "@playwright/test";
test("coupon form, enable switch and worker search agree with server", async ({page}) => {
  await page.request.post('/api/v1/workspaces', {data:{}});
  const made = await page.request.post('/api/v1/plans', {data:{example:true}});
  const initial = await made.json();
  await page.goto('/?plan='+initial.id);
  await expect(page.locator('.total')).toContainText('413.00');
  await page.getByRole('button', {name:'编辑青禾 · 满250减30',exact:true}).click();
  await page.getByRole('textbox', {name:/减免金额/}).fill('40.00');
  await page.getByRole('button', {name:'保存优惠',exact:true}).click();
  await expect(page.locator('.total')).toContainText('403.00');
  await page.getByRole('checkbox', {name:'启用跨店 · 满400减40',exact:true}).click();
  await expect(page.locator('.total')).toContainText('443.00');
  await page.getByRole('checkbox', {name:'启用跨店 · 满400减40',exact:true}).click();
  await expect(page.locator('.total')).toContainText('403.00');
  await page.getByRole('button', {name:'寻找更省的凑单方案',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('已遍历本次有限候选域');
  await page.getByRole('button', {name:'应用方案',exact:true}).click();
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  const saved=await (await page.request.get('/api/v1/plans/'+initial.id)).json();
  const server=await (await page.request.post('/api/v1/pricing/calculate',{data:saved.document})).json();
  expect(server.cash).toBe('40300');
});
test("real UI: create workspace, 413 fixture, edit, save, snapshot, restore and mobile", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "创建我的工作区" }).click();
  await expect(
    page.getByRole("button", { name: /载入验收示例/ }),
  ).toBeVisible();
  const key = await page.locator(".key-box code").innerText();
  await page.getByRole("button", { name: /载入验收示例/ }).click();
  await expect(page.locator(".total")).toContainText("413.00");
  await expect(page.locator(".product-row")).toHaveCount(4);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "棉质短袖 T 恤", exact: true })
    .click();
  await page.getByRole("textbox", { name: /商品单价/ }).fill("200.00");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".total")).toContainText("433.00");
  await expect(page.locator(".save-indicator")).toContainText("已保存");
  await page.reload();
  await expect(page.locator(".total")).toContainText("433.00");
  await page.getByRole("button", { name: "保存快照", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("快照");
  await page.getByRole("button", { name: "历史快照", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  const second = await browser.newContext();
  const p2 = await second.newPage();
  await p2.goto("/");
  await p2.getByPlaceholder("输入工作区恢复密钥").fill(key);
  await p2.getByRole("button", { name: "恢复工作区", exact: true }).click();
  await expect(p2.locator(".total")).toContainText("433.00");
  await second.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "结算", exact: true }).click();
  await expect(page.locator(".total")).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("API guards: isolation, revision conflicts, snapshot idempotence and invalid rules", async ({
  request,
}) => {
  await request.post("/api/v1/workspaces", { data: {} });
  const made = await request.post("/api/v1/plans", { data: { example: true } });
  const p = await made.json();
  expect(made.status()).toBe(200);
  const snapshotRequest = {
    expectedRevision: 1,
    requestId: crypto.randomUUID(),
  };
  const s1 = await request.post(`/api/v1/plans/${p.id}/snapshots`, {
    data: snapshotRequest,
  });
  const s2 = await request.post(`/api/v1/plans/${p.id}/snapshots`, {
    data: snapshotRequest,
  });
  expect(s1.status()).toBe(200);
  expect(s2.status()).toBe(200);
  expect((await s1.json()).id).toBe((await s2.json()).id);
  const good = await request.put(`/api/v1/plans/${p.id}`, {
    data: { expectedRevision: 1, document: p.document },
  });
  expect(good.status()).toBe(200);
  const conflict = await request.put(`/api/v1/plans/${p.id}`, {
    data: { expectedRevision: 1, document: p.document },
  });
  expect(conflict.status()).toBe(409);
  const bad = structuredClone(p.document);
  bad.rules[0].kind = "every_full";
  bad.rules[0].threshold = "0";
  expect(
    (await request.post("/api/v1/pricing/calculate", { data: bad })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/v1/plans", {
        data: {},
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  await request.post("/api/v1/workspaces", { data: {} });
  expect((await request.get(`/api/v1/plans/${p.id}`)).status()).toBe(404);
  expect(
    (
      await request.put(`/api/v1/plans/${p.id}`, {
        data: { expectedRevision: 2, document: p.document },
      })
    ).status(),
  ).toBe(409);
});
