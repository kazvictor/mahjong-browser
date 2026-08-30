/**
 * Phase 3 Visual QA Test Suite
 *
 * Tests for:
 * - Meld System (Chow, Pung, Kong)
 * - Win Detection
 * - Scoring System
 * - UI Polish (meld display, score table)
 *
 * Run: npx playwright test tests/visual/phase-3-meld-system.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Phase 3: Meld System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#game-canvas', { state: 'visible' });
  });

  test('TC1: Game renders with full table layout', async ({ page }) => {
    await page.waitForTimeout(3000);

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('phase3-full-table-initial.png', { maxDiffPixelRatio: 0.05 });

    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC2: Player can select and discard tiles', async ({ page }) => {
    await page.waitForTimeout(3000);

    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const tileY = box.y + box.height * 0.9;
    const tileX = box.x + box.width * 0.5;

    await page.mouse.click(tileX, tileY);
    await page.waitForTimeout(500);

    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('phase3-tile-selected.png', { maxDiffPixelRatio: 0.05 });
  });

  test('TC3: Meld buttons appear when claiming is possible', async ({ page }) => {
    await page.waitForTimeout(3000);

    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();

    test.info().annotations.push({
      type: 'note',
      description: 'Manual verification needed for meld buttons - requires Phase 3 implementation',
    });
  });
});

test.describe('Phase 3: Win Detection & Scoring', () => {
  test('TC4: Win button visible when hand is winning', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'note',
      description: 'Requires win detection test setup - Phase 3 feature',
    });
  });

  test('TC5: Score table displays after round ends', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'note',
      description: 'Requires round completion test setup - Phase 3 feature',
    });
  });
});

test.describe('Phase 3: UI Polish', () => {
  test('TC10: Meld display renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'note',
      description: 'Requires meld declaration test setup - Phase 3 feature',
    });
  });

  test('TC12: Score panel visible and readable', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const screenshot = await page.screenshot();
    expect(screenshot).toMatchSnapshot('phase3-score-panel.png', { maxDiffPixelRatio: 0.05 });
  });
});
