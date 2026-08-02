import puppeteer, {
  type BrowserWorker,
  type Page
} from "@cloudflare/puppeteer";

const MAX_PAGE_TEXT = 20_000;

export interface FetchedPage {
  url: string;
  title: string;
  truncated: boolean;
  text: string;
}

export interface PageLink {
  text: string;
  href: string;
}

export interface FetchedPageWithLinks extends FetchedPage {
  links: PageLink[];
}

const MAX_LINKS = 120;

// Thin wrapper over Browser Rendering. Each call launches and closes its own
// browser; errors propagate to the caller (tools translate them for the model).
export class BrowserClient {
  constructor(private readonly binding: BrowserWorker) {}

  private async withPage<T>(
    url: string,
    fn: (page: Page) => Promise<T>
  ): Promise<T> {
    const browser = await puppeteer.launch(this.binding);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
      return await fn(page);
    } finally {
      await browser.close();
    }
  }

  fetchPage(url: string): Promise<FetchedPage> {
    return this.withPage(url, async (page) => {
      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      return {
        url,
        title,
        truncated: text.length > MAX_PAGE_TEXT,
        text: text.slice(0, MAX_PAGE_TEXT)
      };
    });
  }

  // Like fetchPage, but also collects anchor links so callers (e.g. the news
  // workflow) can resolve article URLs without site-specific selectors.
  fetchPageWithLinks(url: string): Promise<FetchedPageWithLinks> {
    return this.withPage(url, async (page) => {
      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const rawLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
          (a) => ({ text: a.innerText.trim(), href: a.href })
        )
      );

      const seen = new Set<string>();
      const links: PageLink[] = [];
      for (const link of rawLinks) {
        if (links.length >= MAX_LINKS) break;
        if (!link.text || !/^https?:\/\//.test(link.href)) continue;
        if (seen.has(link.href)) continue;
        seen.add(link.href);
        links.push({ text: link.text.slice(0, 200), href: link.href });
      }

      return {
        url,
        title,
        truncated: text.length > MAX_PAGE_TEXT,
        text: text.slice(0, MAX_PAGE_TEXT),
        links
      };
    });
  }

  screenshot(url: string): Promise<Uint8Array> {
    return this.withPage(url, async (page) => {
      return (await page.screenshot({ type: "png" })) as Uint8Array;
    });
  }
}
