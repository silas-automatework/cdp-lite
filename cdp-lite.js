#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const puppeteer = require('puppeteer-core');

const DEFAULT_PORT = Number(process.env.CDP_LITE_PORT) || 9222;
const DEFAULT_HOST = process.env.CDP_LITE_HOST || '127.0.0.1';

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const [, , command, ...argv] = process.argv;

  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'start':
      await startCommand(argv);
      return;
    case 'nav':
      await navCommand(argv);
      return;
    case 'eval':
      await evalCommand(argv);
      return;
    case 'screenshot':
      await screenshotCommand(argv);
      return;
    case 'pick':
      await pickCommand(argv);
      return;
    case 'cookies':
      await cookiesCommand(argv);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
  }
}

function printHelp() {
  console.log(`Chrome DevTools lite helpers

Usage:
  cdp-lite.js start [--profile] [--headless] [--port 9222]
  cdp-lite.js nav <url> [--new] [--port 9222]
  cdp-lite.js eval '<js>' [--json] [--match-url <substr>] [--port 9222]
  cdp-lite.js screenshot [--path file.png] [--full] [--match-url <substr>] [--port 9222]
  cdp-lite.js pick "message" [--match-url <substr>] [--port 9222]
  cdp-lite.js cookies [--url <url>] [--match-url <substr>] [--port 9222]

Defaults:
  host: ${DEFAULT_HOST}
  port: ${DEFAULT_PORT}

Set CHROME_PATH to override the detected Chrome executable.`);
}

function flag(argv, long, short) {
  const idx = argv.findIndex((arg) => arg === long || (short && arg === short));
  if (idx !== -1) {
    argv.splice(idx, 1);
    return true;
  }
  return false;
}

function value(argv, long, short, fallback) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith(`${long}=`)) {
      argv.splice(i, 1);
      return arg.split('=').slice(1).join('=') || fallback;
    }
    if (arg === long || (short && arg === short)) {
      argv.splice(i, 1);
      if (argv[i]) {
        return argv.splice(i, 1)[0];
      }
      return fallback;
    }
  }
  return fallback;
}

function browserUrl(port) {
  return process.env.CDP_LITE_BROWSER_URL || `http://${DEFAULT_HOST}:${port}`;
}

async function startCommand(argv) {
  const port = Number(value(argv, '--port', '-p', DEFAULT_PORT));
  const useProfile = flag(argv, '--profile');
  const headless = flag(argv, '--headless', '-H');
  const userDataDir =
    process.env.CDP_LITE_USER_DATA_DIR ||
    path.join(os.homedir(), '.cache', 'cdp-lite', useProfile ? 'profile' : 'fresh');

  await fs.promises.mkdir(userDataDir, { recursive: true });

  const alreadyUp = await canConnect(browserUrl(port));
  if (alreadyUp) {
    console.log(`Chrome already reachable at ${browserUrl(port)}`);
    return;
  }

  const chromePath = findChrome();
  if (useProfile) {
    await copyProfile(userDataDir);
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
  ];

  if (headless) {
    args.push('--headless=new');
  }

  spawn(chromePath, args, { detached: true, stdio: 'ignore' }).unref();

  const ok = await waitForBrowser(browserUrl(port));
  if (!ok) {
    throw new Error(`Chrome did not become ready on ${browserUrl(port)}`);
  }

  console.log(`Chrome started on ${browserUrl(port)}${headless ? ' (headless)' : ''}`);
}

async function navCommand(argv) {
  const port = Number(value(argv, '--port', '-p', DEFAULT_PORT));
  const openNew = flag(argv, '--new', '-n');
  const matchUrl = value(argv, '--match-url', '-m', null);
  const url = argv.shift();

  if (!url) {
    throw new Error('nav requires a URL');
  }

  const browser = await connectOrThrow(port);
  try {
    const page = openNew ? await browser.newPage() : await activePage(browser, { matchUrl });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(openNew ? `Opened: ${url}` : `Navigated to: ${url}`);
  } finally {
    await browser.disconnect();
  }
}

async function evalCommand(argv) {
  const port = Number(value(argv, '--port', '-p', DEFAULT_PORT));
  const asJson = flag(argv, '--json', '-j');
  const matchUrl = value(argv, '--match-url', '-m', null);
  const code = argv.join(' ').trim();

  if (!code) {
    throw new Error('eval requires JavaScript code in quotes, e.g. "document.title"');
  }

  const browser = await connectOrThrow(port);
  try {
    const page = await activePage(browser, { matchUrl });
    const result = await page.evaluate(async (snippet) => {
      const runner = new Function(`return (async () => (${snippet}))()`);
      return await runner();
    }, code);

    if (asJson || typeof result === 'object') {
      console.log(JSON.stringify(result, null, 2));
    } else if (result === undefined) {
      console.log('undefined');
    } else {
      console.log(String(result));
    }
  } finally {
    await browser.disconnect();
  }
}

async function screenshotCommand(argv) {
  const port = Number(value(argv, '--port', '-p', DEFAULT_PORT));
  const fullPage = flag(argv, '--full', '-f');
  const matchUrl = value(argv, '--match-url', '-m', null);
  const targetPath =
    value(argv, '--path', null, null) || path.join(os.tmpdir(), `cdp-lite-${Date.now()}.png`);

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  const browser = await connectOrThrow(port);
  try {
    const page = await activePage(browser, { matchUrl });
    await page.screenshot({ path: targetPath, fullPage });
    console.log(targetPath);
  } finally {
    await browser.disconnect();
  }
}

async function pickCommand(argv) {
  const port = Number(value(argv, '--port', '-p', DEFAULT_PORT));
  const matchUrl = value(argv, '--match-url', '-m', null);
  const message = argv.join(' ').trim() || 'Click an element';

  const browser = await connectOrThrow(port);
  try {
    const page = await activePage(browser, { matchUrl });
    const result = await page.evaluate(async (msg) => {
      if (window.pick) {
        return await window.pick(msg);
      }

      window.pick = async (prompt) =>
        new Promise((resolve) => {
          const selections = [];
          const selectedEls = new Set();

          const overlay = document.createElement('div');
          overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none';

          const highlight = document.createElement('div');
          highlight.style.cssText =
            'position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.1s';
          overlay.append(highlight);

          const banner = document.createElement('div');
          banner.style.cssText =
            'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:12px 24px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;z-index:2147483647';

          const updateBanner = () => {
            banner.textContent = `${prompt} (${selections.length} selected, Cmd/Ctrl+Click to add, Enter to finish, ESC to cancel)`;
          };
          updateBanner();

          document.body.append(banner, overlay);

          const cleanup = () => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            banner.remove();
            selectedEls.forEach((el) => {
              el.style.outline = '';
            });
          };

          const buildInfo = (el) => {
            const parents = [];
            let current = el.parentElement;
            while (current && current !== document.body) {
              const id = current.id ? `#${current.id}` : '';
              const cls = current.className
                ? `.${current.className.trim().split(/\\s+/).join('.')}`
                : '';
              parents.push(current.tagName.toLowerCase() + id + cls);
              current = current.parentElement;
            }

            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              class: el.className || null,
              text: el.textContent?.trim().slice(0, 200) || null,
              html: el.outerHTML.slice(0, 500),
              parents: parents.join(' > '),
            };
          };

          const onMove = (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || overlay.contains(el) || banner.contains(el)) return;
            const r = el.getBoundingClientRect();
            highlight.style.cssText = `position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`;
          };

          const onClick = (e) => {
            if (banner.contains(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || overlay.contains(el) || banner.contains(el)) return;

            if (e.metaKey || e.ctrlKey) {
              if (!selectedEls.has(el)) {
                selectedEls.add(el);
                el.style.outline = '3px solid #10b981';
                selections.push(buildInfo(el));
                updateBanner();
              }
            } else {
              cleanup();
              const info = buildInfo(el);
              resolve(selections.length > 0 ? selections : info);
            }
          };

          const onKey = (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cleanup();
              resolve(null);
            }
            if (e.key === 'Enter' && selections.length > 0) {
              e.preventDefault();
              cleanup();
              resolve(selections);
            }
          };

          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('click', onClick, true);
          document.addEventListener('keydown', onKey, true);
        });

      return window.pick(msg);
    }, message);

    console.log(result === null ? 'Selection cancelled' : JSON.stringify(result, null, 2));
  } finally {
    await browser.disconnect();
  }
}

async function cookiesCommand(argv) {
  const port = Number(value(argv, '--port', '-p', DEFAULT_PORT));
  const targetUrl = value(argv, '--url', '-u', null);
  const matchUrl = value(argv, '--match-url', '-m', null);

  const browser = await connectOrThrow(port);
  try {
    const page = await activePage(browser, { matchUrl });
    const cookies = await page.cookies(targetUrl || page.url());
    console.log(JSON.stringify(cookies, null, 2));
  } finally {
    await browser.disconnect();
  }
}

async function connectOrThrow(port) {
  try {
    return await puppeteer.connect({
      browserURL: browserUrl(port),
      defaultViewport: null,
      timeout: 5000,
    });
  } catch (error) {
    throw new Error(
      `Cannot connect to Chrome at ${browserUrl(port)}. Run "cdp-lite.js start" first. (${error.message})`
    );
  }
}

async function activePage(browser, { matchUrl } = {}) {
  const pages = await browser.pages();
  const usable = pages.filter((p) => !p.url().startsWith('devtools://'));
  let candidate = null;

  if (matchUrl) {
    candidate =
      usable.find((p) => {
        const url = p.url();
        return url && url.includes(matchUrl);
      }) || null;
  }

  candidate = candidate || usable.at(-1) || pages.at(-1) || (await browser.newPage());
  await candidate.bringToFront();
  return candidate;
}

async function canConnect(url) {
  try {
    const browser = await puppeteer.connect({
      browserURL: url,
      defaultViewport: null,
      timeout: 1000,
    });
    await browser.disconnect();
    return true;
  } catch {
    return false;
  }
}

async function waitForBrowser(url) {
  for (let i = 0; i < 30; i += 1) {
    if (await canConnect(url)) return true;
    await sleep(500);
  }
  return false;
}

function findChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  const inPath = (...names) => {
    for (const name of names) {
      const which = spawnSync('which', [name], { encoding: 'utf8' });
      if (which.status === 0 && which.stdout.trim()) {
        return which.stdout.trim();
      }
    }
    return null;
  };

  const platform = process.platform;
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    );
    const pathChrome = inPath('google-chrome', 'chrome', 'chromium');
    if (pathChrome) candidates.push(pathChrome);
  } else if (platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES || 'C:\\\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\\\Program Files (x86)';
    candidates.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  } else {
    const pathChrome = inPath(
      'google-chrome-stable',
      'google-chrome',
      'chromium-browser',
      'chromium',
      'chrome'
    );
    if (pathChrome) candidates.push(pathChrome);
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium');
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Chrome not found. Set CHROME_PATH to the Chrome executable.');
}

async function copyProfile(targetDir) {
  const platform = process.platform;
  const sources = [];

  if (process.env.CDP_LITE_PROFILE_SOURCE) {
    sources.push(process.env.CDP_LITE_PROFILE_SOURCE);
  }

  if (platform === 'darwin') {
    sources.push(path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'));
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    sources.push(path.join(localAppData, 'Google', 'Chrome', 'User Data'));
  } else {
    sources.push(path.join(os.homedir(), '.config', 'google-chrome'));
    sources.push(path.join(os.homedir(), '.config', 'chromium'));
  }

  const source = sources.find((candidate) => candidate && fs.existsSync(candidate));
  if (!source) {
    console.warn('No profile found to copy; starting with a fresh profile.');
    return;
  }

  // Chromium/Snap profiles often contain broken Singleton* symlinks when the
  // profile was copied from another machine or a previous run. These are just
  // lock artifacts and safe to skip.
  await fs.promises.cp(source, targetDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== 'SingletonCookie' && base !== 'SingletonLock' && base !== 'SingletonSocket';
    },
  });
}
