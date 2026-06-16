import { groqChat } from "./llm.js";
import type { Sentiment } from "../types/domain.js";

export interface SentimentResult {
  sentiment: Sentiment;
  score: number;
  summary: string;
  keyIssues: string[];
  resolved: boolean;
}

export async function analyzeSentiment(transcript: string): Promise<SentimentResult> {
  const fallback: SentimentResult = {
    sentiment: "neutral",
    score: 70,
    summary: "Call completed and is awaiting deeper analysis.",
    keyIssues: [],
    resolved: true
  };

  const content = await groqChat([
    {
      role: "system",
      content: "Analyze call transcripts. Return strict JSON only with sentiment, score, summary, keyIssues, and resolved."
    },
    {
      role: "user",
      content: `Transcript:\n${transcript}`
    }
  ]);

  if (!content) return fallback;

  try {
    const parsed = JSON.parse(content) as SentimentResult;
    return {
      sentiment: parsed.sentiment,
      score: Math.max(0, Math.min(100, Number(parsed.score))),
      summary: parsed.summary,
      keyIssues: Array.isArray(parsed.keyIssues) ? parsed.keyIssues : [],
      resolved: Boolean(parsed.resolved)
    };
  } catch {
    return fallback;
  }
}
