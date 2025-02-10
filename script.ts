import chalk from "chalk";
import Table from "cli-table3";
import { JSDOM } from "jsdom";
import ora from "ora";
import pLimit from "p-limit";
import { chromium } from "playwright";
import { z } from "zod";

// Define the websites to scrape
const websites = [
  "https://www.openairsg.ch/",
  "https://www.szeneopenair.at/",
  "https://www.starsofsounds.ch/",
  "https://www.reeds-festival.ch/",
  // "https://www.montreuxjazzfestival.com/",
  // "https://yeah.paleo.ch/",
  // "https://www.gurtenfestival.ch/",
];

// const websites = ["https://www.boltshauser.solutions"];

// Validate URLs before processing
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function getTimestamp(): string {
  return chalk.gray(`[${new Date().toLocaleTimeString()}]`);
}

function stripHtmlForLLM(html: string): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Remove unnecessary elements
  const elementsToRemove = [
    "script",
    "style",
    "meta",
    "link",
    "svg",
    "noscript",
    "iframe",
    "object",
    "embed",
    "header",
    "footer",
    "nav",
  ];
  elementsToRemove.forEach((tag) => {
    document.querySelectorAll(tag).forEach((el) => el.remove());
  });

  // Remove attributes from non-anchor elements to reduce token size
  document.querySelectorAll("*").forEach((el) => {
    if (el.tagName.toLowerCase() === "a") {
      // For anchor tags, only keep href attribute
      const href = el.getAttribute("href");
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }
      if (href) {
        el.setAttribute("href", href);
      }
    } else {
      // For all other elements, remove all attributes
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // Get HTML content preserving tags
  const htmlContent = document.body?.innerHTML || "";

  // Remove extra whitespace and common noise
  return htmlContent
    .trim()
    .replace(/\s+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, ""); // Remove HTML comments
}

function getDomainFromUrl(url: string): string {
  const hostname = new URL(url).hostname;
  const parts = hostname.split(".");

  // If we have more than 2 parts (e.g., www.example.com)
  if (parts.length > 2) {
    // Take the last two parts at minimum (example.com)
    // If the second-to-last part is very short (like 'co' in .co.uk), take one more
    const secondToLast = parts[parts.length - 2];
    if (secondToLast.length <= 2 && parts.length > 3) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  }

  // If we only have two parts or less (example.com or localhost)
  return hostname;
}

function normalizeUrl(baseUrl: string, relativeUrl: string): string {
  try {
    // Handle empty or invalid URLs
    if (
      !relativeUrl ||
      relativeUrl === "#" ||
      relativeUrl.startsWith("mailto:") ||
      relativeUrl.startsWith("tel:") ||
      relativeUrl.startsWith("javascript:")
    ) {
      return "";
    }

    // If it's already an absolute URL, validate and return it
    if (relativeUrl.match(/^https?:\/\//)) {
      const url = new URL(relativeUrl);
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.toString()
        : "";
    }

    // Handle protocol-relative URLs (//example.com)
    if (relativeUrl.startsWith("//")) {
      const url = new URL(`https:${relativeUrl}`);
      return url.toString();
    }

    // Handle root-relative URLs (/path) and relative URLs (path or ../path)
    const url = new URL(relativeUrl, baseUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch (error) {
    return "";
  }
}

function extractRelevantLinks(
  baseUrl: string,
  html: string
): { link: string }[] {
  try {
    // Validate base URL first
    const baseUrlObj = new URL(baseUrl);
    if (baseUrlObj.protocol !== "https:" && baseUrlObj.protocol !== "http:") {
      return [];
    }

    const baseDomain = getDomainFromUrl(baseUrl);

    return Array.from(html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>/g))
      .map((match) => ({
        link: normalizeUrl(baseUrl, match[1]),
      }))
      .filter(({ link }) => {
        if (!link) return false;
        try {
          const url = new URL(link);
          // Only keep valid HTTP(S) URLs from the same domain
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            getDomainFromUrl(link) === baseDomain
          );
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

async function extractEmailsFromUrl(url: string): Promise<string[]> {
  const domain = getDomainFromUrl(url);
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: 30000 }).catch(() => {
      throw new Error(`Timeout accessing ${url}`);
    });
    const html = await page.content();

    // Create more flexible email regex that includes common variations
    const emailRegex = new RegExp(
      `[a-zA-Z0-9._%+-]+@(?:${domain}|${domain.replace(/\./g, "\\.")}|${domain
        .split(".")
        .slice(-2)
        .join("\\.")})`,
      "gmi"
    );

    // Extract emails from the HTML
    const emails = [...new Set(html.match(emailRegex) || [])];

    return emails;
  } finally {
    await browser.close();
  }
}

class BrowserPool {
  private browsers: Array<{
    browser: any;
    inUse: boolean;
  }> = [];
  private maxBrowsers: number;

  constructor(maxBrowsers: number) {
    this.maxBrowsers = maxBrowsers;
  }

  async acquire() {
    // Check for available browser
    const availableBrowser = this.browsers.find((b) => !b.inUse);
    if (availableBrowser) {
      availableBrowser.inUse = true;
      return availableBrowser.browser;
    }

    // Create new browser if under limit
    if (this.browsers.length < this.maxBrowsers) {
      const browser = await chromium.launch();
      this.browsers.push({ browser, inUse: true });
      return browser;
    }

    // Wait for available browser
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const browser = this.browsers.find((b) => !b.inUse);
        if (browser) {
          clearInterval(checkInterval);
          browser.inUse = true;
          resolve(browser.browser);
        }
      }, 100);
    });
  }

  release(browser: any) {
    const browserEntry = this.browsers.find((b) => b.browser === browser);
    if (browserEntry) {
      browserEntry.inUse = false;
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

async function main() {
  // Validate URLs first
  const invalidUrls = websites.filter((url) => !isValidUrl(url));
  if (invalidUrls.length > 0) {
    console.error(
      chalk.red("❌ Invalid URLs detected:"),
      invalidUrls.join(", ")
    );
    process.exit(1);
  }

  // Define schema to extract contents into
  const relevantLinksSchema = z.object({
    top: z
      .array(
        z.object({
          link: z.string(),
        })
      )
      .describe(
        "List of relevant links that might yield more information and emails of organizers, search for links that allow application of artists and bands etc! Only include links that have the same domain, and that are yielding possibilities to find more email addresses! Not just some random links like gallery, bühne, etc. Focus on terms like bands, application, bewerbung, etc. Take only the most relevant links!"
      ),
  });

  type EmailSource = {
    link: string;
    email: string;
    timestamp: string;
  };

  type Result = {
    domain: string;
    emailsWithSources: EmailSource[];
    error?: string;
  };

  function printHeader() {
    console.clear();
    console.log(
      chalk.cyan(`
╭──────────────────────────────────╮
│   ${chalk.bold("🎯 Contact Discovery Engine")}    │
╰──────────────────────────────────╯
`)
    );
  }

  function refreshDisplay(table: Table.Table) {
    printHeader();
    console.log("\n" + table.toString() + "\n");
  }

  // Initial display
  printHeader();

  const mainSpinner = ora({
    text: getTimestamp() + " 🔍 Contact discovery in progress...",
    color: "blue",
  }).start();

  // Initialize browser pool and concurrency limit
  const browserPool = new BrowserPool(4); // Limit to 4 concurrent browsers
  const limit = pLimit(4); // Limit concurrent processing

  // Create a single status spinner for all updates
  const statusSpinner = ora({
    text: "",
    color: "cyan",
  });

  try {
    // Create progress table
    const progressTable = new Table({
      head: [
        chalk.blue("Domain"),
        chalk.blue("Status"),
        chalk.blue("Sub-links"),
        chalk.blue("Progress"),
        chalk.blue("Emails Found"),
        chalk.blue("Last Update"),
      ],
      style: {
        head: [],
        border: [],
      },
    }) as Table.Table & {
      [index: number]: string[];
    };

    // Initialize table with domains
    websites.forEach((url) => {
      progressTable.push([
        getDomainFromUrl(url),
        chalk.yellow("Pending"),
        "-",
        "-",
        "-",
        getTimestamp(),
      ]);
    });

    refreshDisplay(progressTable);
    console.log(""); // Add space for status spinner

    function updateProgressTable(
      index: number,
      updates: { [key: string]: string },
      statusMessage?: string
    ) {
      Object.entries(updates).forEach(([key, value]) => {
        switch (key) {
          case "status":
            (progressTable[index] as string[])[1] = value;
            break;
          case "subLinks":
            (progressTable[index] as string[])[2] = value;
            break;
          case "progress":
            (progressTable[index] as string[])[3] = value;
            break;
          case "emailsFound":
            (progressTable[index] as string[])[4] = value;
            break;
          case "lastUpdate":
            (progressTable[index] as string[])[5] = value;
            break;
        }
      });
      refreshDisplay(progressTable);
      console.log(""); // Add space for status spinner
      if (statusMessage) {
        statusSpinner.text = statusMessage;
      }
    }

    async function processWebsite(url: string, index: number): Promise<Result> {
      const domain = getDomainFromUrl(url);

      let browser;
      try {
        browser = await browserPool.acquire();
        const page = await browser.newPage();
        await page.goto(url, { timeout: 30000 }).catch(() => {
          throw new Error(`Timeout accessing ${url}`);
        });
        const html = await page.content();

        updateProgressTable(
          index,
          {
            status: chalk.blue("Analyzing links"),
            lastUpdate: getTimestamp(),
          },
          chalk.cyan(`Analyzing ${domain}...`)
        );

        let emails: string[] = [];
        emails.push(...(await extractEmailsFromUrl(url)));

        const relevantLinksResult = {
          object: {
            top: extractRelevantLinks(url, html),
          },
        };

        const totalSubLinks = relevantLinksResult.object.top.length;
        updateProgressTable(
          index,
          {
            subLinks: chalk.yellow(`${totalSubLinks}`),
            progress: chalk.yellow(`0/${totalSubLinks}`),
            lastUpdate: getTimestamp(),
          },
          chalk.cyan(`Found ${totalSubLinks} sub-links in ${domain}`)
        );

        updateProgressTable(
          index,
          {
            status: chalk.blue("Extracting emails"),
          },
          chalk.cyan(`Processing sub-links for ${domain}...`)
        );

        let processedLinks = 0;
        let failedLinks = 0;

        const emailPromises = relevantLinksResult.object.top.map(
          (link: { link: string }) =>
            limit(async () => {
              try {
                const linkEmails = await extractEmailsFromUrl(link.link);
                processedLinks++;
                const progress = `${
                  processedLinks + failedLinks
                }/${totalSubLinks}`;
                const progressPercentage =
                  ((processedLinks + failedLinks) / totalSubLinks) * 100;
                const progressColor =
                  progressPercentage < 33
                    ? "yellow"
                    : progressPercentage < 66
                      ? "blue"
                      : "green";

                updateProgressTable(
                  index,
                  {
                    progress: chalk[progressColor](progress),
                    lastUpdate: getTimestamp(),
                  },
                  chalk.cyan(`Processing ${domain}: ${progress} sub-links`)
                );

                return linkEmails.map(
                  (email): EmailSource => ({
                    link: link.link,
                    email,
                    timestamp: new Date().toISOString(),
                  })
                );
              } catch (error) {
                failedLinks++;
                const progress = `${
                  processedLinks + failedLinks
                }/${totalSubLinks}`;
                updateProgressTable(
                  index,
                  {
                    progress: chalk.yellow(progress),
                    lastUpdate: getTimestamp(),
                  },
                  chalk.yellow(`Failed processing a sub-link in ${domain}`)
                );
                return [];
              }
            })
        );

        const allEmailResults = await Promise.all(emailPromises);
        const emailsWithSources = allEmailResults.flat() as EmailSource[];
        const uniqueEmailsWithSources = Array.from(
          new Map(
            emailsWithSources.map((item: EmailSource) => [item.email, item])
          ).values()
        );

        const status =
          failedLinks === 0
            ? chalk.green("Complete")
            : failedLinks === totalSubLinks
              ? chalk.red("All Failed")
              : chalk.yellow(`Partial (${failedLinks} failed)`);

        const statusMessage =
          failedLinks === 0
            ? chalk.green(`Completed processing ${domain}`)
            : failedLinks === totalSubLinks
              ? chalk.red(`Failed processing all sub-links for ${domain}`)
              : chalk.yellow(
                  `Completed ${domain} with ${failedLinks} failed sub-links`
                );

        updateProgressTable(
          index,
          {
            status,
            progress: chalk.green(`${totalSubLinks}/${totalSubLinks}`),
            emailsFound:
              chalk.green(`${uniqueEmailsWithSources.length}`) +
              (failedLinks > 0 ? chalk.red(` (${failedLinks} errors)`) : ""),
            lastUpdate: getTimestamp(),
          },
          statusMessage
        );

        return {
          domain,
          emailsWithSources: uniqueEmailsWithSources,
          error:
            failedLinks > 0 ? `${failedLinks} sub-links failed` : undefined,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(getTimestamp(), `Error processing ${url}:`, error);

        updateProgressTable(
          index,
          {
            status: chalk.red("Failed"),
            emailsFound: chalk.red(errorMessage),
            lastUpdate: getTimestamp(),
          },
          chalk.red(`Failed processing ${domain}: ${errorMessage}`)
        );

        return {
          domain,
          emailsWithSources: [],
          error: errorMessage,
        };
      } finally {
        if (browser) {
          browserPool.release(browser);
        }
      }
    }

    // Process all websites in parallel
    const websitePromises = websites.map((url, index) =>
      processWebsite(url, index)
    );
    const results = await Promise.all(websitePromises);

    // Clear the status spinner before showing summary
    statusSpinner.stop();

    // Final Summary
    printHeader();
    console.log(chalk.bold.cyan("\n📊 Final Summary\n"));

    const summaryTable = new Table({
      head: [
        chalk.blue("Domain"),
        chalk.blue("Emails Found"),
        chalk.blue("Source URLs"),
        chalk.blue("Discovery Time"),
        chalk.blue("Status"),
      ],
      style: {
        head: [],
        border: [],
      },
      wordWrap: true,
      wrapOnWordBoundary: true,
    });

    results.forEach(({ domain, emailsWithSources, error }: Result) => {
      // Even with errors, if we have emails, show them
      if (error && emailsWithSources.length === 0) {
        // Only show as failed if we have no emails at all
        summaryTable.push([
          domain,
          chalk.red("No emails found"),
          chalk.red("N/A"),
          chalk.gray(new Date().toLocaleTimeString()),
          chalk.red(`Error: ${error}`),
        ]);
      } else {
        // Show any successful results, even if there were some errors
        const uniqueUrls = [
          ...new Set(emailsWithSources.map((item: EmailSource) => item.link)),
        ];
        summaryTable.push([
          domain,
          emailsWithSources.length > 0
            ? emailsWithSources
                .map((item: EmailSource) => chalk.green(item.email))
                .join("\n")
            : chalk.yellow("No emails found"),
          uniqueUrls.map((url: string) => chalk.yellow(url)).join("\n") ||
            chalk.gray("No valid URLs"),
          emailsWithSources
            .map((item: EmailSource) =>
              chalk.gray(new Date(item.timestamp).toLocaleTimeString())
            )
            .join("\n") || chalk.gray("-"),
          error
            ? chalk.yellow(`Partial Success (${error})`)
            : chalk.green("Success"),
        ]);
      }
    });

    console.log(summaryTable.toString());
    console.log(chalk.bold.green("\n✨ Scraping completed successfully!\n"));
  } finally {
    await browserPool.closeAll();
  }
}

main().catch((error) => {
  console.error(chalk.red("\n❌ Fatal error:"), error);
  process.exit(1);
});
