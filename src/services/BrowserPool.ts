import { Browser, chromium } from "playwright";

export class BrowserPool {
  private browsers: Array<{
    browser: Browser;
    inUse: boolean;
  }> = [];
  private maxBrowsers: number;

  constructor(maxBrowsers: number) {
    this.maxBrowsers = maxBrowsers;
  }

  async acquire(): Promise<Browser> {
    try {
      // Create new browser if under limit, prioritize new instances over reuse
      if (this.browsers.length < this.maxBrowsers) {
        const browser = await chromium.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        });
        const newBrowserEntry = { browser, inUse: true };
        this.browsers.push(newBrowserEntry);
        return browser;
      }

      // Only try to reuse if we've hit the limit
      const availableBrowser = this.browsers.find((b) => !b.inUse);
      if (availableBrowser) {
        availableBrowser.inUse = true;
        return availableBrowser.browser;
      }

      // If we reach here, we need to wait for a browser to become available
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 100; // Reduce wait time to 10 seconds

        const checkInterval = setInterval(() => {
          attempts++;
          const browser = this.browsers.find((b) => !b.inUse);

          if (browser) {
            clearInterval(checkInterval);
            browser.inUse = true;
            resolve(browser.browser);
            return;
          }

          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            reject(new Error("Timeout waiting for available browser"));
          }
        }, 100);
      });
    } catch (error) {
      throw error;
    }
  }

  release(browser: Browser) {
    const browserEntry = this.browsers.find((b) => b.browser === browser);
    if (browserEntry) {
      // Close and remove the browser instead of reusing
      browserEntry.browser.close().catch(console.error);
      this.browsers = this.browsers.filter((b) => b !== browserEntry);
    }
  }

  async closeAll() {
    await Promise.all(
      this.browsers.map(async (b) => {
        try {
          await b.browser.close();
        } catch (error) {
          console.error("Error closing browser:", error);
        }
      })
    );
    this.browsers = [];
  }
}
