import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App desktop chat shell", () => {
  it("renders the translated titlebar, 250px sidebar, glass chat header, and source-shaped sendbox", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="matey-shell"');
    expect(markup).toContain('class="app-titlebar app-titlebar--desktop"');
    expect(markup).toContain('aria-label="Toggle sidebar"');
    expect(markup).toContain('aria-label="Back"');
    expect(markup).toContain('aria-label="Forward"');
    expect(markup).toContain('class="layout-sider"');
    expect(markup).toContain('data-width="250"');
    expect(markup).toContain('class="chat-layout-header chat-layout-header--glass"');
    expect(markup).toContain('class="sendbox-panel"');
    expect(markup).not.toContain("Desktop chat");
    expect(markup).not.toContain('class="message-avatar"');
    expect(markup).not.toContain('class="app-titlebar__brand"');
  });

  it("supports selecting chats, navigation history, and new local chat creation", () => {
    render(<App />);

    fireEvent.click(screen.getByText("Release notes outline"));
    expect(screen.getByRole("heading", { name: "Release notes outline" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Design review prep" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByRole("heading", { name: "Release notes outline" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("heading", { name: /New local chat/ })).toBeTruthy();
  });

  it("filters conversations and toggles local panels", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Search conversations" }));
    fireEvent.change(screen.getByLabelText("Conversation search input"), {
      target: { value: "weekend" },
    });
    expect(screen.getByText("Weekend planning")).toBeTruthy();
    expect(screen.queryByText("Release notes outline")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Scheduled items" }));
    expect(screen.getByText(/No scheduled items/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/Settings panel is local/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toggle workspace" }));
    expect(screen.getByLabelText("Workspace preview")).toBeTruthy();
  });

  it("controls composer tools and sends deterministic local replies", () => {
    render(<App />);

    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
    expect(screen.getByText(/Local attachment ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
    expect(screen.getByText(/Listening locally/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Model selector" }));
    expect(screen.getByText(/Matey Swift/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message input"), {
      target: { value: "Hello local Matey" },
    });
    fireEvent.click(send);
    expect(screen.getByText("Hello local Matey")).toBeTruthy();
    expect(screen.getByText(/Local reply noted for/)).toBeTruthy();
  });

  it("uses Enter to send and Shift+Enter to keep composing", () => {
    render(<App />);
    const input = screen.getByLabelText("Message input");

    fireEvent.change(input, { target: { value: "Line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(input).toHaveProperty("value", "Line one");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Line one")).toBeTruthy();
  });
});
