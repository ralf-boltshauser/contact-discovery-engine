import bodyParser from "body-parser";
import cors from "cors";
import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { BrowserPool } from "../services/BrowserPool";
import { EmailExtractor } from "../services/EmailExtractor";
import { Result } from "../types";
import { extractRelevantLinks } from "../utils/url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Middleware
  app.use(cors());
  app.use(bodyParser.json({ limit: "10mb" }));
  app.use(express.static(path.join(__dirname)));

  // Browser pool configuration
  const BROWSER_POOL_SIZE = 20;
  const CONCURRENT_SUBLINKS = 20;
  const browserPool = new BrowserPool(BROWSER_POOL_SIZE);
  const emailExtractor = new EmailExtractor(browserPool);

  app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });

  // SSE endpoint for real-time updates
  app.get("/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send an initial connection message
    res.write("event: connected\ndata: Connected to event stream\n\n");

    // Store the response object in the request for cleanup
    req.on("close", () => {
      res.end();
    });
  });

  app.post("/discover", async (req: Request, res: Response) => {
    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Please provide at least one URL" });
    }

    // Set up SSE connection for this discovery session
    const sseRes = res;
    sseRes.setHeader("Content-Type", "text/event-stream");
    sseRes.setHeader("Cache-Control", "no-cache");
    sseRes.setHeader("Connection", "keep-alive");
    sseRes.flushHeaders();

    try {
      // Send initial status
      sseRes.write(
        `data: ${JSON.stringify({ type: "start", total: urls.length })}\n\n`
      );

      const results: Result[] = [];

      for (const [index, url] of urls.entries()) {
        try {
          const formattedUrl = url.startsWith("http") ? url : `https://${url}`;
          const domain = new URL(formattedUrl).hostname;

          // Send processing status
          sseRes.write(
            `data: ${JSON.stringify({
              type: "processing",
              domain,
              current: index + 1,
              total: urls.length,
              status: "Analyzing main URL",
            })}\n\n`
          );

          let browser = null;
          let page = null;
          let emailsWithSources = [];

          try {
            browser = await browserPool.acquire();
            page = await browser.newPage();

            // Navigate to the URL
            await page.goto(formattedUrl, {
              timeout: 30000,
              waitUntil: "networkidle",
            });

            const html = await page.content();

            // Get initial emails
            const initialEmails =
              await emailExtractor.extractEmailsFromUrl(formattedUrl);
            emailsWithSources = [
              ...initialEmails.primaryEmails.map((email) => ({
                email,
                link: formattedUrl,
                timestamp: new Date().toISOString(),
                isPrimaryDomain: true,
              })),
              ...initialEmails.otherEmails.map((email) => ({
                email,
                link: formattedUrl,
                timestamp: new Date().toISOString(),
                isPrimaryDomain: false,
              })),
            ];

            // Extract sublinks
            const relevantLinks = extractRelevantLinks(formattedUrl, html);
            const totalSubLinks = relevantLinks.length;

            // Send sublinks found status
            sseRes.write(
              `data: ${JSON.stringify({
                type: "sublinks_found",
                domain,
                count: totalSubLinks,
              })}\n\n`
            );

            // Process sublinks
            let processedLinks = 0;
            let failedLinks = 0;

            for (const link of relevantLinks) {
              try {
                console.log(`Processing sublink: ${link.link}`);
                const { primaryEmails, otherEmails } =
                  await emailExtractor.extractEmailsFromUrl(link.link);

                processedLinks++;

                // Add emails from sublink
                emailsWithSources.push(
                  ...primaryEmails.map((email) => ({
                    email,
                    link: link.link,
                    timestamp: new Date().toISOString(),
                    isPrimaryDomain: true,
                  })),
                  ...otherEmails.map((email) => ({
                    email,
                    link: link.link,
                    timestamp: new Date().toISOString(),
                    isPrimaryDomain: false,
                  }))
                );

                // Send sublink progress
                sseRes.write(
                  `data: ${JSON.stringify({
                    type: "sublink_progress",
                    domain,
                    processedLinks,
                    failedLinks,
                    totalSubLinks: totalSubLinks,
                    currentLink: link.link,
                  })}\n\n`
                );
              } catch (error) {
                failedLinks++;
                console.error(`Error processing sublink ${link.link}:`, error);

                // Send sublink error and progress update
                sseRes.write(
                  `data: ${JSON.stringify({
                    type: "sublink_error",
                    domain,
                    link: link.link,
                    error:
                      error instanceof Error ? error.message : "Unknown error",
                  })}\n\n`
                );

                // Send updated progress after error
                sseRes.write(
                  `data: ${JSON.stringify({
                    type: "sublink_progress",
                    domain,
                    processedLinks,
                    failedLinks,
                    totalSubLinks: totalSubLinks,
                    currentLink: link.link,
                  })}\n\n`
                );
              }
            }

            // Remove duplicate emails
            const uniqueEmailsWithSources = Array.from(
              new Map(
                emailsWithSources.map((item) => [item.email, item])
              ).values()
            );

            const result = {
              domain,
              emailsWithSources: uniqueEmailsWithSources,
              error:
                failedLinks > 0 ? `${failedLinks} sub-links failed` : undefined,
            };

            results.push(result);

            // Send final result for this domain
            sseRes.write(
              `data: ${JSON.stringify({
                type: "result",
                result: {
                  domain,
                  primaryEmails: uniqueEmailsWithSources
                    .filter((item) => item.isPrimaryDomain)
                    .map((item) => ({
                      email: item.email,
                      source: item.link,
                      timestamp: item.timestamp,
                    })),
                  otherEmails: uniqueEmailsWithSources
                    .filter((item) => !item.isPrimaryDomain)
                    .map((item) => ({
                      email: item.email,
                      source: item.link,
                      timestamp: item.timestamp,
                    })),
                  sublinksProcessed: processedLinks,
                  sublinksFailed: failedLinks,
                  totalSublinks: totalSubLinks,
                },
              })}\n\n`
            );
          } finally {
            if (page) await page.close().catch(console.error);
            if (browser) browserPool.release(browser);
          }
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          const errorResult = {
            domain: url,
            emailsWithSources: [],
            error: error instanceof Error ? error.message : "Unknown error",
          };
          results.push(errorResult);

          // Send error result
          sseRes.write(
            `data: ${JSON.stringify({
              type: "error",
              result: {
                domain: url,
                error: error instanceof Error ? error.message : "Unknown error",
              },
            })}\n\n`
          );
        }
      }

      // Send completion event
      sseRes.write(
        `data: ${JSON.stringify({ type: "complete", results })}\n\n`
      );
      sseRes.end();
    } catch (error) {
      console.error("Error processing URLs:", error);
      sseRes.write(
        `data: ${JSON.stringify({
          type: "error",
          error: "Internal server error",
        })}\n\n`
      );
      sseRes.end();
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down gracefully...");
    await browserPool.closeAll();
    process.exit(0);
  });

  app.listen(port, () => {
    console.log(
      `🎯 Contact Discovery Engine is running at http://localhost:${port}`
    );
  });
}
