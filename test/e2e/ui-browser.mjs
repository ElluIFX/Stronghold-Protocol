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
