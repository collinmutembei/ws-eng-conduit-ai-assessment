import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ZOLLY = {
  email: 'zgorey2@livejournal.com',
  password: 'password',
  username: 'Zolly Gorey',
};

const JOHN = {
  email: 'jcosten0@purevolume.com',
  password: 'password',
  username: 'John Costen',
};

let sharedArticlePath = '';
let sharedArticleTitle = '';

test.describe.serial('advanced co-authors basic acceptance', () => {
  test('Test 1: Zolly creates an article with John as co-author', async ({ page }) => {
    sharedArticleTitle = `Playwright Coauthor ${Date.now()}`;
    const description = 'Acceptance test article for advanced co-authors';
    const body = 'This article is used to verify co-author editing access.';
    const tag = 'playwright-coauthor';

    await login(page, ZOLLY.email, ZOLLY.password);
    await page.getByRole('link', { name: 'New Article' }).click();

    await page.getByPlaceholder('Article Title').fill(sharedArticleTitle);
    await page.getByPlaceholder("What's this article about?").fill(description);
    await page.getByPlaceholder('Write your article (in markdown)').fill(body);
    await page.getByLabel('Co-authors').selectOption([{ label: JOHN.username }]);
    await page.getByPlaceholder('Enter the tag name and press enter').fill(tag);
    await page.getByPlaceholder('Enter the tag name and press enter').press('Enter');

    await expect(page.locator('#coAuthors')).toHaveValues([JOHN.username]);
    await page.screenshot({ path: 'submission/test1.png' });

    await page.getByRole('button', { name: 'Publish Article' }).click();
    await expect(page.getByRole('heading', { level: 1, name: sharedArticleTitle })).toBeVisible();

    sharedArticlePath = page.url().replace('http://127.0.0.1:3001', '');
    await expect(sharedArticlePath).toContain('/#/article/');
  });

  test('Test 2: John can open the shared article and edit it', async ({ page }) => {
    expect(sharedArticlePath).not.toBe('');

    await login(page, JOHN.email, JOHN.password);
    await page.goto(sharedArticlePath);

    const editArticleButton = page.getByRole('button', { name: /Edit Article/ }).first();

    await expect(page.getByRole('heading', { level: 1, name: sharedArticleTitle })).toBeVisible();
    await expect(editArticleButton).toBeVisible();
    await editArticleButton.click();

    await expect(page.getByPlaceholder('Article Title')).toHaveValue(sharedArticleTitle);
    await expect(page.locator('#coAuthors')).toHaveValues([JOHN.username]);

    await page.screenshot({ path: 'submission/test2.png' });
  });

  test('Test 3: Zolly sees a warning when John already holds the article edit lock', async ({ browser }) => {
    expect(sharedArticlePath).not.toBe('');

    const johnContext = await newIsolatedContext(browser);
    const zollyContext = await newIsolatedContext(browser);
    const johnPage = await johnContext.newPage();
    const zollyPage = await zollyContext.newPage();

    try {
      await login(johnPage, JOHN.email, JOHN.password);
      await johnPage.goto(sharedArticlePath);
      await johnPage.getByRole('button', { name: /Edit Article/ }).first().click();
      await expect(johnPage.getByPlaceholder('Article Title')).toHaveValue(sharedArticleTitle);
      await johnPage.screenshot({ path: 'submission/test3a.png' });

      await login(zollyPage, ZOLLY.email, ZOLLY.password);
      await zollyPage.goto(sharedArticlePath);
      await zollyPage.getByRole('button', { name: /Edit Article/ }).first().click();

      const warningBanner = zollyPage.getByRole('alert');
      await expect(warningBanner).toContainText('This article is currently locked for editing by another user.');
      await expect(zollyPage.getByPlaceholder('Article Title')).toBeDisabled();

      await zollyPage.screenshot({ path: 'submission/test3b.png' });
      await zollyPage.screenshot({ path: 'submission/test3.png' });
    } finally {
      await johnContext.close();
      await zollyContext.close();
    }
  });
});

async function newIsolatedContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 1280, height: 720 } });
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/#/login');

  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('link', { name: 'New Article' })).toBeVisible();
}
