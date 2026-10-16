import { existsSync } from 'node:fs';
import path from 'node:path';

const chromePaths = [
  path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
  ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')] : []),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

export const UI_CHROME = process.env.CHROME_PATH || chromePaths.find(candidate => existsSync(candidate)) || '';
export const UI_BROWSER_ARGS = Object.freeze(['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1']);

/** Close pages and temporary contexts after each serial UI test, including failed navigation or assertions. */
export async function cleanupUiBrowser(browser) {
  if (!browser) return;
  const errors = [];
  try {
    const pages = await browser.pages();
    const results = await Promise.allSettled(pages.map(async page => { if (!page.isClosed()) await page.close(); }));
    errors.push(...results.filter(result => result.status === 'rejected').map(result => result.reason));
  } catch (error) { errors.push(error); }
  try {
    const contexts = browser.browserContexts().filter(context => context !== browser.defaultBrowserContext());
    const results = await Promise.allSettled(contexts.map(async context => context.close()));
    errors.push(...results.filter(result => result.status === 'rejected').map(result => result.reason));
  } catch (error) { errors.push(error); }
  if (errors.length) {
    try { await browser.close(); } catch (error) { errors.push(error); }
    throw new AggregateError(errors, 'Failed to close UI test browser resources');
  }
}
