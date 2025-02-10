import { Browser, Page } from "playwright";
import { getDomainFromUrl } from "../utils/url";
import { BrowserPool } from "./BrowserPool";

export interface ExtractedEmails {
  primaryEmails: string[];
  otherEmails: string[];
}

export class EmailExtractor {
  private browserPool: BrowserPool;

  constructor(browserPool: BrowserPool) {
    this.browserPool = browserPool;
  }

  async extractEmailsFromUrl(url: string): Promise<ExtractedEmails> {
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

      // Extract primary domain emails
      const primaryDomainRegex = new RegExp(
        `[a-zA-Z0-9._%+-]+@(?:${domain}|${domain.replace(
          /\./g,
          "\\."
        )}|${domain.split(".").slice(-2).join("\\.")})`,
        "gmi"
      );

      // Extract all emails
      const allEmailsRegex =
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gim;

      const primaryEmails = [
        ...new Set(html.match(primaryDomainRegex) || []),
      ] as string[];
      const allEmails = [
        ...new Set(html.match(allEmailsRegex) || []),
      ] as string[];

      // Filter out primary emails from other emails
      const otherEmails = allEmails.filter(
        (email) => !primaryEmails.includes(email)
      );

      return { primaryEmails, otherEmails };
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
