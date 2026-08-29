import { expect, test } from "@playwright/test";

test("human demo exposes both designed license failures", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.locator(".license-number")).toHaveText("10");

  await page.getByRole("button", { name: "Add license", exact: true }).click();
  await expect(page.locator(".license-number")).toHaveText("12");

  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Remove license", exact: true }).click();
  await expect(page.getByText("Remove license timed out", { exact: true })).toBeVisible();
  await expect(page.locator(".license-number")).toHaveText("10");
});

test("production server supports admin SPA routes", async ({ page }) => {
  await page.goto("/admin/overview");
  await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible();
  await page.getByRole("link", { name: /Issues/ }).first().click();
  await expect(page).toHaveURL(/\/admin\/issues$/);
  await page.goto("/admin/issues/INC-9999");
  await expect(page.getByRole("heading", { name: "No issues reported yet" })).toBeVisible();
});
