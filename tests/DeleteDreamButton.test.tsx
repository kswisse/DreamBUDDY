// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import DeleteDreamButton from "@/components/DeleteDreamButton";

describe("DeleteDreamButton", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-enables the button when the dream no longer exists (404)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    render(<DeleteDreamButton dreamId="d1" />);
    const button = screen.getByRole<HTMLButtonElement>("button");

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("This dream no longer exists.")).toBeTruthy();
    });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Delete dream");
    expect(push).not.toHaveBeenCalled();
  });

  it("re-enables the button when the server errors (500)", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    render(<DeleteDreamButton dreamId="d1" />);
    const button = screen.getByRole<HTMLButtonElement>("button");

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Could not delete this dream. Please try again.")).toBeTruthy();
    });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Delete dream");
  });

  it("re-enables the button when the network fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<DeleteDreamButton dreamId="d1" />);
    const button = screen.getByRole<HTMLButtonElement>("button");

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Could not reach the server.")).toBeTruthy();
    });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Delete dream");
  });

  it("navigates home after a successful delete", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<DeleteDreamButton dreamId="d1" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
    expect(refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/dreams/d1", { method: "DELETE" });
  });
});
