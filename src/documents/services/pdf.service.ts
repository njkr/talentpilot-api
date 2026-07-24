import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { Env } from '../../config/config.module';

const MAX_PAGES_BEFORE_RECYCLE = 50;

@Injectable()
export class PdfService implements OnModuleDestroy {
  private browser: Browser | null = null;
  private pagesRendered = 0;

  constructor(private readonly env: Env) {}

  /**
   * ONE browser, reused. Launching Chromium costs 1-2 seconds — doing it per job makes
   * document generation feel broken.
   *
   * But Chromium leaks memory steadily, so we recycle the whole browser every 50 pages.
   * Without that, the worker's RSS climbs until the OOM killer takes it, usually at
   * 3am and usually mid-job.
   */
  private async getBrowser(): Promise<Browser> {
    if (
      this.browser?.connected &&
      this.pagesRendered < MAX_PAGES_BEFORE_RECYCLE
    ) {
      return this.browser;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.pagesRendered = 0;
    }

    // PUPPETEER_EXECUTABLE_PATH is only set in the containerized worker image (which
    // skips downloading its own Chromium and installs the system package instead —
    // see Dockerfile.worker). Locally, omitting executablePath lets Puppeteer fall
    // back to the Chromium it downloaded for itself at `npm install` time.
    const executablePath =
      this.env.get('PUPPETEER_EXECUTABLE_PATH') || undefined;

    this.browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox', // required in most containers (no user namespaces)
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // ← without this Chromium crashes in Docker:
        //   the default /dev/shm is 64MB and it needs more
        '--disable-gpu',
        '--font-render-hinting=none', // consistent text metrics across machines
      ],
    });
    return this.browser;
  }

  async render(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // 'networkidle0' isn't a valid setContent() wait condition in this Puppeteer
      // version (that option only applies to real navigations) — 'load' is correct
      // here anyway since our HTML has no external resources to wait on.
      await page.setContent(html, { waitUntil: 'load' });

      // Wait for fonts. Without this you intermittently get a PDF rendered in Times New
      // Roman because the webfont hadn't loaded when the snapshot was taken — and it's
      // intermittent, so it passes your manual test and fails for users.
      // Passed as a string (not a typed function) — the callback runs in the browser's
      // DOM context, and this project's tsconfig has no "dom" lib (Node-only), so a
      // typed arrow function referencing `document` would fail to compile here.
      await page.evaluate('document.fonts.ready');

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      });
      this.pagesRendered++;
      return Buffer.from(pdf);
    } finally {
      await page.close(); // ALWAYS — a leaked page is a leaked renderer process
    }
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => {});
  }
}
