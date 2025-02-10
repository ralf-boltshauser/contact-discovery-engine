import { Browser, Page } from "playwright";
import { getDomainFromUrl } from "../utils/url";
import { BrowserPool } from "./BrowserPool";

export class EmailExtractor {
  private browserPool: BrowserPool;

  constructor(browserPool: BrowserPool) {
    this.browserPool = browserPool;
  }

  async extractEmailsFromUrl(url: string): Promise<string[]> {
    const domain = getDomainFromUrl(url);
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      browser = await this.browserPool.acquire();
      page = await browser.newPage();

      // Simplified navigation without networkidle wait
      await page
        .goto(url, {
          timeout: 30000,
        })
        .catch((error) => {
          throw new Error(`Timeout accessing ${url}`);
        });

      // Wait for the body to be available
      await page.waitForSelector("body", { timeout: 5000 }).catch(() => {});

      const html = await page.content();

      // Create more flexible email regex that includes common variations
      const emailRegex = new RegExp(
        `[a-zA-Z0-9._%+-]+@(?:${domain}|${domain.replace(
          /\./g,
          "\\."
        )}|${domain.split(".").slice(-2).join("\\.")})`,
        "gmi"
      );

      // Extract emails from the HTML with type assertion
      const emails = [...new Set(html.match(emailRegex) || [])] as string[];

      return emails;
    } catch (error) {
      throw error;
    } finally {
      if (page) {
        await page.close().catch(console.error);
      }
      if (browser) {
        this.browserPool.release(browser);
      }
    }
  }
}
