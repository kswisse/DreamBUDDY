import { describe, it, expect } from "vitest";
import {
  dreamAnalysisSchema,
  extractAnalysis,
  type DreamAnalysis,
} from "@/lib/analysis/schema";

const valid = {
  summary: "You navigated a flooded school hallway with growing confidence.",
  themes: ["adaptation", "school"],
  emotions: ["anxiety", "relief"],
  symbols: [{ name: "flood water", meaning: "overwhelming emotion" }],
  reflection: "What felt overwhelming this week, and how did you adapt?",
  mood_after: "relieved",
};

describe("dreamAnalysisSchema", () => {
  it("accepts a valid analysis", () => {
    const parsed = dreamAnalysisSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it("rejects an analysis with a missing field", () => {
    const broken = { ...valid };
    delete (broken as Record<string, unknown>).reflection;
    expect(dreamAnalysisSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects empty theme lists", () => {
    expect(
      dreamAnalysisSchema.safeParse({ ...valid, themes: [] }).success,
    ).toBe(false);
  });

  it("rejects more than 8 themes", () => {
    const themes = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(dreamAnalysisSchema.safeParse({ ...valid, themes }).success).toBe(
      false,
    );
  });
});

describe("extractAnalysis", () => {
  it("parses a bare JSON object", () => {
    const result = extractAnalysis(JSON.stringify(valid));
    expect(result).toEqual(valid);
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const text = "Here you go:\n```json\n" + JSON.stringify(valid) + "\n```\nHope that helps!";
    expect(extractAnalysis(text)).toEqual(valid);
  });

  it("parses JSON embedded in prose", () => {
    const text = "Sure! The analysis is " + JSON.stringify(valid) + " Let me know.";
    const result: DreamAnalysis = extractAnalysis(text);
    expect(result.summary).toBe(valid.summary);
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractAnalysis("I could not analyze this dream.")).toThrow(
      /no JSON/i,
    );
  });

  it("throws when the JSON does not match the schema", () => {
    expect(() => extractAnalysis('{"summary": 42}')).toThrow();
  });

  it("throws when the JSON object is truncated", () => {
    expect(() => extractAnalysis('{"summary": "cut off he')).toThrow();
  });
});

describe("normalize before validate", () => {
  it("trims, dedupes and slices excess themes", () => {
    const raw = {
      ...valid,
      themes: [" a ", "A", "b", "c", "d", "e", "f", "g", "h", "i", ""],
    };
    const result = extractAnalysis(JSON.stringify(raw));
    expect(result.themes).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("trims and dedupes emotions case-insensitively", () => {
    const raw = { ...valid, emotions: [" calm ", "CALM", "", "joy"] };
    const result = extractAnalysis(JSON.stringify(raw));
    expect(result.emotions).toEqual(["calm", "joy"]);
  });

  it("drops symbol entries with an empty name or meaning", () => {
    const raw = {
      ...valid,
      symbols: [
        { name: " wings ", meaning: " freedom " },
        { name: "", meaning: "x" },
        { name: "y", meaning: "   " },
        { name: "flame", meaning: "desire" },
      ],
    };
    const result = extractAnalysis(JSON.stringify(raw));
    expect(result.symbols).toEqual([
      { name: "wings", meaning: "freedom" },
      { name: "flame", meaning: "desire" },
    ]);
  });

  it("slices symbols to the maximum of 10", () => {
    const symbols = Array.from({ length: 15 }, (_, i) => ({
      name: `s${i}`,
      meaning: `m${i}`,
    }));
    const result = extractAnalysis(JSON.stringify({ ...valid, symbols }));
    expect(result.symbols).toHaveLength(10);
    expect(result.symbols[9]).toEqual({ name: "s9", meaning: "m9" });
  });

  it("still fails when a required field is missing", () => {
    const broken = { ...valid };
    delete (broken as Record<string, unknown>).reflection;
    expect(() => extractAnalysis(JSON.stringify(broken))).toThrow(
      /failed validation/i,
    );
  });
});

describe("candidate scanning", () => {
  it("picks the analysis when an unrelated JSON object comes first", () => {
    const text = `{"note":"let me think"}\n${JSON.stringify(valid)}`;
    expect(extractAnalysis(text)).toEqual(valid);
  });

  it("skips malformed JSON objects before the real analysis", () => {
    const text = `Thinking {broken braces} ... ${JSON.stringify(valid)}`;
    expect(extractAnalysis(text)).toEqual(valid);
  });

  it("reports the validation error of the last candidate", () => {
    const first = { ...valid, summary: 42 };
    const last = { ...valid, themes: [] };
    const text = `${JSON.stringify(first)}\n${JSON.stringify(last)}`;
    expect(() => extractAnalysis(text)).toThrow(/too small/i);
  });
});
