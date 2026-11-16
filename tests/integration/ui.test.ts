import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app-deps.ts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { closePools, getPools, makeApp, resetSettings } from '../support.ts';

describe('browser table', () => {
  let browser: Browser | undefined;

  beforeAll(async () => {
    await build({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)) });
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    const pools = await getPools();
    await resetSettings(pools.admin);
  });

  afterAll(async () => {
    await browser?.close();
    await closePools();
  });

  it('deals a hand, ranks the session, and lets the house comp it', async () => {
    const pools = await getPools();
    const staticDir = fileURLToPath(new URL('../../dist/web', import.meta.url));
    const app = makeApp(pools, { staticDir });
    const { url: base, close } = await listen(app);

    const page = await browser!.newPage({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(base);
      await page.getByTestId('bankroll').waitFor();
      expect(await page.getByTestId('bankroll').innerText()).toBe('$100,000.00');
      expect(await page.getByTestId('bet').innerText()).toBe('$25.00');

      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/bet') && response.request().method() === 'POST'),
        page.getByTestId('deal').click(),
      ]);
      await settle(page);

      await page.getByTestId('result').waitFor();
      const name = (await page.getByTestId('display-name').innerText()).trim();
      expect(name.length).toBeGreaterThan(1);
      await expectText(page.locator('#board'), name);

      await page.setViewportSize({ width: 390, height: 844 });
      const gameWidth = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(gameWidth.scroll).toBeLessThanOrEqual(gameWidth.inner + 1);

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${base}/admin`);
      await page.getByLabel('Username').fill('admin');
      await page.getByLabel('Password').fill('test-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByTestId('stats').waitFor();
      await page.getByTestId('session-row').filter({ hasText: name }).click();
      await page.getByTestId('hand-history').waitFor();
      const history = await page.getByTestId('hand-history').innerText();
      expect(history).not.toContain('No hands yet.');
      expect(history.length).toBeGreaterThan(8);

      await page.getByTestId('reason').fill('UI comp');
      await page.getByTestId('adjust-amount').fill('1');
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/adjust') && response.ok()),
        page.getByRole('button', { name: 'Apply chips' }).click(),
      ]);
      await page.getByText('Saved.').waitFor();

      await page.setViewportSize({ width: 390, height: 844 });
      const adminWidth = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(adminWidth.scroll).toBeLessThanOrEqual(adminWidth.inner + 1);
    } finally {
      await page.close();
      await close();
    }
  }, 180_000);
});

function listen(app: Hono<AppEnv>): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.on('error', reject);
  });
}

async function settle(page: Page): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    await page.waitForFunction(() => document.querySelector('.felt')?.getAttribute('data-busy') === 'false');
    const next = await page.evaluate(() => {
      if (document.querySelector('[data-testid="result"]')) return 'done';
      if (document.querySelector('[data-testid="action-even_money"]')) return 'even_money';
      if (document.querySelector('[data-testid="action-decline"]')) return 'decline';
      if (document.querySelector('[data-testid="action-stand"]')) return 'stand';
      return 'wait';
    });
    if (next === 'done') return;
    if (next === 'wait') throw new Error('The hand offered no result and no action');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/action') && response.request().method() === 'POST'),
      page.getByTestId(`action-${next}`).click(),
    ]);
  }
  throw new Error('The hand did not finish');
}

async function expectText(locator: ReturnType<Page['locator']>, text: string): Promise<void> {
  await locator.waitFor();
  const body = await locator.innerText();
  expect(body).toContain(text);
}
