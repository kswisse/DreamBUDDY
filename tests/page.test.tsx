// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const repo = vi.hoisted(() => ({
  list: [] as unknown[],
  count: 0,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({
    list: () => repo.list,
    count: () => repo.count,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import JournalPage from "@/app/page";

function makeDream(id: string) {
  return {
    id,
    title: `Dream ${id}`,
    content: "A dream about flying.",
    dreamDate: "2026-09-26",
    mood: "calm",
    analysisStatus: "none" as const,
  };
}

describe("JournalPage", () => {
  beforeEach(() => {
    repo.list = [];
    repo.count = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the truncation marker when fewer rows are listed than the total", () => {
    repo.list = Array.from({ length: 50 }, (_, i) => makeDream(`d${i}`));
    repo.count = 60;

    render(<JournalPage />);

    expect(screen.getByText("60 entries")).toBeTruthy();
    expect(
      screen.getByText("Showing the 50 most recent of 60 entries."),
    ).toBeTruthy();
    expect(screen.getByText("Dream d0")).toBeTruthy();
  });

  it("omits the truncation marker when every entry is listed", () => {
    repo.list = Array.from({ length: 5 }, (_, i) => makeDream(`d${i}`));
    repo.count = 5;

    render(<JournalPage />);

    expect(screen.getByText("5 entries")).toBeTruthy();
    expect(screen.queryByText(/Showing the/)).toBeNull();
  });

  it("renders the empty state with no marker when there are no dreams", () => {
    repo.list = [];
    repo.count = 0;

    render(<JournalPage />);

    expect(screen.getByText("No dreams yet.")).toBeTruthy();
    expect(screen.queryByText(/Showing the/)).toBeNull();
    expect(screen.getByText("0 entries")).toBeTruthy();
  });

  it("uses the singular label when there is exactly one entry", () => {
    repo.list = [makeDream("only")];
    repo.count = 1;

    render(<JournalPage />);

    expect(screen.getByText("1 entry")).toBeTruthy();
    expect(screen.queryByText(/entries/)).toBeNull();
    expect(screen.queryByText(/Showing the/)).toBeNull();
    expect(screen.getByText("Dream only")).toBeTruthy();
  });

  it("renders the content as the heading when the title is empty", () => {
    repo.list = [{ ...makeDream("no-title"), title: "" }];
    repo.count = 1;

    render(<JournalPage />);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("A dream about flying.");
  });

  it("truncates the content fallback at 60 characters with no ellipsis", () => {
    const content = `${"a".repeat(60)} trailing tail beyond the cut`;
    repo.list = [{ ...makeDream("long"), title: "", content }];
    repo.count = 1;

    render(<JournalPage />);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("a".repeat(60));
    expect(heading.textContent).not.toBe(content);
  });

  it("renders the mood chip for a mooded dream", () => {
    repo.list = [makeDream("mooded")];
    repo.count = 1;

    render(<JournalPage />);

    expect(screen.getByText("· calm")).toBeTruthy();
  });

  it("renders no mood chip when the mood is empty", () => {
    repo.list = [{ ...makeDream("no-mood"), mood: "" }];
    repo.count = 1;

    render(<JournalPage />);

    expect(screen.queryByText(/·/)).toBeNull();
    expect(screen.getByText("2026-09-26")).toBeTruthy();
    expect(screen.getByText("Not analyzed")).toBeTruthy();
  });
});
