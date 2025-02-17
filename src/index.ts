import chalk from "chalk";
import { Command } from "commander";
import fs from "fs";
import ora from "ora";
import pLimit from "p-limit";
import path from "path";
import { Browser, Page } from "playwright";
import { z } from "zod";
import { BrowserPool } from "./services/BrowserPool";
import { EmailExtractor } from "./services/EmailExtractor";
import { EmailSource, Result } from "./types";
import {
  createProgressTable,
  createSummaryTable,
  getTimestamp,
  printHeader,
  refreshDisplay,
  updateProgressTable,
} from "./ui/display";
import { extractRelevantLinks, isValidUrl } from "./utils/url";

// Increase concurrency limits significantly
const CONCURRENT_WEBSITES = 1;
const CONCURRENT_SUBLINKS = 20;
const BROWSER_POOL_SIZE = 20;

// Replace the hardcoded websites array with Commander setup
const program = new Command();

program
  .name("contact-discovery-engine")
  .description("A tool to discover contact information from websites")
  .option("-w, --web", "Start in web interface mode")
  .argument(
    "[domains...]",
    "Domain names to scan (e.g., domain-1.com domain-2.com)"
  )
  .action(async (domains, options) => {
    if (options.web) {
      // Start web interface
      const { startWebServer } = await import("./web/server");
      startWebServer();
      return;
    }

    // CLI mode
    if (!domains || domains.length === 0) {
      console.error(
        chalk.red(
          "❌ Please provide at least one domain or use --web for web interface"
        )
      );
      process.exit(1);
    }

    const websites = domains.map((domain: string) =>
      domain.startsWith("http://") || domain.startsWith("https://")
        ? domain
        : `https://${domain}`
    );

    await runCLI(websites);
  })
  .parse();

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

async function processWebsite(
  url: string,
  index: number,
  browserPool: BrowserPool,
  emailExtractor: EmailExtractor,
  progressTable: any,
  statusSpinner: any
): Promise<Result> {
  const domain = new URL(url).hostname;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let emailsWithSources: EmailSource[] = [];

  try {
    browser = await browserPool.acquire();
    page = await browser.newPage();

    updateProgressTable(progressTable, index, {
      status: chalk.blue("Analyzing links"),
      lastUpdate: getTimestamp(),
    });
    statusSpinner.text = chalk.cyan(`Analyzing ${domain}...`);

    await page.goto(url, { timeout: 30000 }).catch(() => {
      throw new Error(`Timeout accessing ${url}`);
    });
    const html = await page.content();

    // Get initial emails
    const initialEmails = await emailExtractor.extractEmailsFromUrl(url);

    // Extract links before closing the main page
    const relevantLinksResult = {
      object: {
        top: extractRelevantLinks(url, html),
      },
    };

    // Close the main page to free up resources
    await page.close();
    page = null;
    browserPool.release(browser);
    browser = null;

    const totalSubLinks = relevantLinksResult.object.top.length;
    updateProgressTable(progressTable, index, {
      subLinks: chalk.yellow(`${totalSubLinks}`),
      progress: chalk.yellow(`0/${totalSubLinks}`),
      lastUpdate: getTimestamp(),
    });
    statusSpinner.text = chalk.cyan(
      `Found ${totalSubLinks} sub-links in ${domain}`
    );

    updateProgressTable(progressTable, index, {
      status: chalk.blue("Extracting emails"),
    });
    statusSpinner.text = chalk.cyan(`Processing sub-links for ${domain}...`);

    let processedLinks = 0;
    let failedLinks = 0;
    const limit = pLimit(CONCURRENT_SUBLINKS);

    // Process sub-links in smaller batches
    const emailPromises = relevantLinksResult.object.top.map((link) =>
      limit(async () => {
        try {
          const { primaryEmails, otherEmails } =
            await emailExtractor.extractEmailsFromUrl(link.link);
          processedLinks++;
          const progress = `${processedLinks + failedLinks}/${totalSubLinks}`;
          const progressPercentage =
            ((processedLinks + failedLinks) / totalSubLinks) * 100;
          const progressColor =
            progressPercentage < 33
              ? "yellow"
              : progressPercentage < 66
                ? "blue"
                : "green";

          updateProgressTable(progressTable, index, {
            progress: chalk[progressColor](progress),
            lastUpdate: getTimestamp(),
          });
          statusSpinner.text = chalk.cyan(
            `Processing ${domain}: ${progress} sub-links`
          );

          return [
            ...primaryEmails.map(
              (email: string): EmailSource => ({
                link: link.link,
                email,
                timestamp: new Date().toISOString(),
                isPrimaryDomain: true,
              })
            ),
            ...otherEmails.map(
              (email: string): EmailSource => ({
                link: link.link,
                email,
                timestamp: new Date().toISOString(),
                isPrimaryDomain: false,
              })
            ),
          ];
        } catch (error) {
          failedLinks++;
          const progress = `${processedLinks + failedLinks}/${totalSubLinks}`;
          updateProgressTable(progressTable, index, {
            progress: chalk.yellow(progress),
            lastUpdate: getTimestamp(),
          });
          statusSpinner.text = chalk.yellow(
            `Failed processing a sub-link in ${domain}`
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

    updateProgressTable(progressTable, index, {
      status,
      progress: chalk.green(`${totalSubLinks}/${totalSubLinks}`),
      emailsFound:
        chalk.green(`${uniqueEmailsWithSources.length}`) +
        (failedLinks > 0 ? chalk.red(` (${failedLinks} errors)`) : ""),
      lastUpdate: getTimestamp(),
    });
    statusSpinner.text = statusMessage;

    return {
      domain,
      emailsWithSources: uniqueEmailsWithSources,
      error: failedLinks > 0 ? `${failedLinks} sub-links failed` : undefined,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(getTimestamp(), `Error processing ${url}:`, error);

    updateProgressTable(progressTable, index, {
      status: chalk.red("Failed"),
      emailsFound: chalk.red(errorMessage),
      lastUpdate: getTimestamp(),
    });
    statusSpinner.text = chalk.red(
      `Failed processing ${domain}: ${errorMessage}`
    );

    return {
      domain,
      emailsWithSources: [],
      error: errorMessage,
    };
  } finally {
    if (page) {
      await page.close().catch(console.error);
    }
    if (browser) {
      browserPool.release(browser);
    }
  }
}

async function runCLI(websites: string[]) {
  // Validate URLs first
  const invalidUrls = websites.filter((url) => !isValidUrl(url));
  if (invalidUrls.length > 0) {
    console.error(
      chalk.red("❌ Invalid URLs detected:"),
      invalidUrls.join(", ")
    );
    process.exit(1);
  }

  // Initial display
  printHeader();

  const mainSpinner = ora({
    text: getTimestamp() + " 🔍 Contact discovery in progress...",
    color: "blue",
  }).start();

  // Initialize browser pool with more browsers
  const browserPool = new BrowserPool(BROWSER_POOL_SIZE);
  const emailExtractor = new EmailExtractor(browserPool);

  // Create a single status spinner for all updates
  const statusSpinner = ora({
    text: "",
    color: "cyan",
  });

  try {
    // Create progress table
    const progressTable = createProgressTable();

    // Initialize table with domains
    websites.forEach((url) => {
      progressTable.push([
        new URL(url).hostname,
        chalk.yellow("Pending"),
        "-",
        "-",
        "-",
        getTimestamp(),
      ]);
    });

    refreshDisplay(progressTable);
    console.log(""); // Add space for status spinner

    // Process websites with concurrency limit
    const limit = pLimit(CONCURRENT_WEBSITES);
    const websitePromises = websites.map((url, index) =>
      limit(() =>
        processWebsite(
          url,
          index,
          browserPool,
          emailExtractor,
          progressTable,
          statusSpinner
        )
      )
    );
    const results = await Promise.all(websitePromises);

    // Clear both spinners before showing summary
    statusSpinner.stop();
    mainSpinner.stop();

    // Final Summary
    printHeader();
    console.log(chalk.bold.cyan("\n📊 Final Summary\n"));

    const summaryTable = createSummaryTable();

    results.forEach((result) => {
      const { domain, emailsWithSources, error } = result;
      if (error && emailsWithSources.length === 0) {
        summaryTable.push([
          domain,
          chalk.red("No emails found"),
          chalk.red("N/A"),
          chalk.gray(new Date().toLocaleTimeString()),
          chalk.red(`Error: ${error}`),
        ]);
      } else {
        const uniqueUrls = [
          ...new Set(emailsWithSources.map((item: EmailSource) => item.link)),
        ];

        const primaryEmails = emailsWithSources
          .filter((item) => item.isPrimaryDomain)
          .map((item) => chalk.green(item.email));

        const otherEmails = emailsWithSources
          .filter((item) => !item.isPrimaryDomain)
          .map((item) => chalk.yellow(item.email));

        const emailDisplay = [
          primaryEmails.length > 0
            ? chalk.bold("Primary Domain Emails:") +
              "\n" +
              primaryEmails.join("\n")
            : "",
          otherEmails.length > 0
            ? "\n" + chalk.bold("Other Emails:") + "\n" + otherEmails.join("\n")
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        summaryTable.push([
          domain,
          emailsWithSources.length > 0
            ? emailDisplay
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

    // Save results to JSON file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = "results";
    const filename = `contact-discovery-${timestamp}.json`;

    // Create results directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const outputPath = path.join(outputDir, filename);
    const jsonResults = results.map(({ domain, emailsWithSources, error }) => ({
      domain,
      primaryEmails: emailsWithSources
        .filter((item) => item.isPrimaryDomain)
        .map((item) => ({
          email: item.email,
          source: item.link,
          timestamp: item.timestamp,
        })),
      otherEmails: emailsWithSources
        .filter((item) => !item.isPrimaryDomain)
        .map((item) => ({
          email: item.email,
          source: item.link,
          timestamp: item.timestamp,
        })),
      error: error || null,
    }));

    fs.writeFileSync(outputPath, JSON.stringify(jsonResults, null, 2));
    console.log(chalk.cyan(`\n💾 Results saved to: ${outputPath}\n`));
  } finally {
    // Make sure both spinners are stopped even if there's an error
    statusSpinner.stop();
    mainSpinner.stop();
    await browserPool.closeAll();
  }
}
