import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { BrowserClient } from "./browser";
import type { ChatAgent } from "./agent";

const TOPICS_URL = "https://news.yahoo.co.jp/topics/top-picks";

export interface NewsProgress {
  step: string;
  message: string;
}

const newsItemSchema = z.object({
  title: z.string().describe("記事の見出し"),
  url: z.string().describe("リンク一覧に実在するURL"),
  summary: z.string().describe("1文の内容説明")
});

type NewsItem = z.infer<typeof newsItemSchema>;

interface ArticleSummary {
  title: string;
  url: string;
  reason: string;
  summary: string;
}

// Runbook: collect today's Japanese news via the headless browser, pick the
// 3 most valuable items with the LLM, read each article, save as markdown.
export class NewsWorkflow extends AgentWorkflow<
  ChatAgent,
  Record<string, never>,
  NewsProgress
> {
  private model() {
    const google = createGoogleGenerativeAI({
      apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY
    });
    return google(this.env.MODEL || "gemini-2.5-flash");
  }

  private browser() {
    return new BrowserClient(this.env.BROWSER as BrowserWorker);
  }

  async run(
    _event: AgentWorkflowEvent<Record<string, never>>,
    step: AgentWorkflowStep
  ) {
    await this.reportProgress({
      step: "fetch-topics",
      message: "Yahoo!ニュースをブラウザで開いています..."
    });
    const page = await step.do("fetch-topics", () =>
      this.browser().fetchPageWithLinks(TOPICS_URL)
    );

    await this.reportProgress({
      step: "extract-10",
      message: "ニュース候補を10件抽出しています..."
    });
    const candidates = await step.do("extract-10", async () => {
      const { object } = await generateObject({
        model: this.model(),
        schema: z.object({ items: z.array(newsItemSchema).max(12) }),
        prompt: [
          "以下はニューストピックスページの本文とリンク一覧です。",
          "今日の日本語ニュース記事をちょうど10件選び、title / url / summary を返してください。",
          "url は必ずリンク一覧に実在するものを使うこと。ナビゲーションや広告のリンクは除外すること。",
          "",
          `# ページタイトル\n${page.title}`,
          `# 本文\n${page.text}`,
          `# リンク一覧\n${page.links.map((l) => `- ${l.text} :: ${l.href}`).join("\n")}`
        ].join("\n")
      });
      return object.items.slice(0, 10);
    });

    await this.reportProgress({
      step: "select-3",
      message: "価値のあるニュースを3件選定しています..."
    });
    const picks = await step.do("select-3", async () => {
      const { object } = await generateObject({
        model: this.model(),
        schema: z.object({
          picks: z
            .array(
              z.object({
                url: z.string().describe("候補リストに実在するURL"),
                reason: z.string().describe("選定理由(1〜2文)")
              })
            )
            .max(3)
        }),
        prompt: [
          "以下のニュース候補10件から、社会的影響・新規性・読者への実用性の観点で最も価値のある3件を選び、選定理由を添えてください。",
          "",
          JSON.stringify(candidates, null, 2)
        ].join("\n")
      });
      return object.picks.slice(0, 3);
    });

    const articles: ArticleSummary[] = [];
    for (const [i, pick] of picks.entries()) {
      const candidate = candidates.find((c: NewsItem) => c.url === pick.url);
      const title = candidate?.title ?? pick.url;

      await this.reportProgress({
        step: `read-article-${i + 1}`,
        message: `記事を読んでいます (${i + 1}/${picks.length}): ${title}`
      });

      let summary: string;
      try {
        summary = await step.do(
          `read-article-${i + 1}`,
          { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
          async () => {
            const article = await this.browser().fetchPage(pick.url);
            const { text } = await generateText({
              model: this.model(),
              prompt: [
                "以下のニュース記事本文を日本語で3〜4文に要約してください。要約のみを出力すること。",
                "",
                `# ${article.title}`,
                article.text
              ].join("\n")
            });
            return text.trim();
          }
        );
      } catch {
        // One unreadable article should not kill the whole runbook.
        summary = candidate?.summary ?? "(記事本文の取得に失敗しました)";
      }

      articles.push({ title, url: pick.url, reason: pick.reason, summary });
    }

    await this.reportProgress({
      step: "save",
      message: "Markdownを保存しています..."
    });
    const path = await step.do("save", async () => {
      const jstDate = new Date(Date.now() + 9 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      const filePath = `news/${jstDate}.md`;
      await this.agent.writeWorkspaceFile(
        filePath,
        buildMarkdown(jstDate, candidates, articles)
      );
      return filePath;
    });

    await step.reportComplete({ path });
    return { path };
  }
}

function buildMarkdown(
  date: string,
  candidates: NewsItem[],
  articles: ArticleSummary[]
): string {
  const top3 = articles
    .map(
      (a, i) =>
        `### ${i + 1}. [${a.title}](${a.url})\n\n**選定理由:** ${a.reason}\n\n${a.summary}`
    )
    .join("\n\n");
  const list = candidates
    .map((c) => `- [${c.title}](${c.url}) — ${c.summary}`)
    .join("\n");
  return `# 今日のニュース (${date})\n\n## 注目の3件\n\n${top3}\n\n## 収集した候補 (${candidates.length}件)\n\n${list}\n`;
}
