import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

type Message = {
  author: "You" | "Matey";
  tone: "user" | "assistant";
  text: string;
};

type Conversation = {
  id: string;
  title: string;
  when: string;
  messages: Message[];
};

const starterConversations: Conversation[] = [
  {
    id: "design-review-prep",
    title: "Design review prep",
    when: "Today",
    messages: [
      {
        author: "You",
        tone: "user",
        text: "Can you turn the rough launch notes into a calm checklist for tomorrow morning?",
      },
      {
        author: "Matey",
        tone: "assistant",
        text: "Yes. I grouped the work into three sections: confirm the audience, tighten the demo path, and prepare one fallback note for each open question.",
      },
      {
        author: "You",
        tone: "user",
        text: "Keep it short enough to scan during the meeting.",
      },
      {
        author: "Matey",
        tone: "assistant",
        text: "Draft ready: lead with the goal, show the current screen, call out the two decisions needed, and close with owners for follow-up.",
      },
    ],
  },
  {
    id: "release-notes-outline",
    title: "Release notes outline",
    when: "Earlier",
    messages: [{ author: "Matey", tone: "assistant", text: "Local outline ready for review." }],
  },
  {
    id: "research-follow-up",
    title: "Research follow-up",
    when: "Earlier",
    messages: [
      { author: "Matey", tone: "assistant", text: "I saved three local follow-up prompts." },
    ],
  },
  {
    id: "weekend-planning",
    title: "Weekend planning",
    when: "Earlier",
    messages: [
      { author: "Matey", tone: "assistant", text: "A light weekend plan is waiting here." },
    ],
  },
];

const initialConversation = starterConversations[0] as Conversation;
const models = ["Matey Default", "Matey Swift", "Matey Careful"];
const maxComposerHeight = 180;

function SidebarPanelIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="36" height="28" rx="5" stroke="currentColor" strokeWidth="3" />
      <line x1="18" y1="10" x2="18" y2="38" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg className="sider-svg-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 15.5L20 20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function ScheduledIcon(): React.JSX.Element {
  return (
    <svg className="sider-svg-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 7.5V12L15 14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg className="sider-svg-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8.5A3.5 3.5 0 1 1 12 15.5A3.5 3.5 0 0 1 12 8.5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M19 13.4V10.6L16.9 10.1C16.7 9.5 16.5 9 16.2 8.5L17.3 6.6L15.4 4.7L13.5 5.8C13 5.5 12.5 5.3 11.9 5.1L11.4 3H8.6L8.1 5.1C7.5 5.3 7 5.5 6.5 5.8L4.6 4.7L2.7 6.6L3.8 8.5C3.5 9 3.3 9.5 3.1 10.1L1 10.6V13.4L3.1 13.9C3.3 14.5 3.5 15 3.8 15.5L2.7 17.4L4.6 19.3L6.5 18.2C7 18.5 7.5 18.7 8.1 18.9L8.6 21H11.4L11.9 18.9C12.5 18.7 13 18.5 13.5 18.2L15.4 19.3L17.3 17.4L16.2 15.5C16.5 15 16.7 14.5 16.9 13.9L19 13.4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
        transform="translate(2)"
      />
    </svg>
  );
}

export function App(): React.JSX.Element {
  const [conversations, setConversations] = useState(starterConversations);
  const [activeId, setActiveId] = useState(initialConversation.id);
  const [history, setHistory] = useState([initialConversation.id]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [managementMode, setManagementMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dimTheme, setDimTheme] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [attached, setAttached] = useState(false);
  const [modelIndex, setModelIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("Ready");
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ?? initialConversation;
  const canSend = draft.trim().length > 0;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(term));
  }, [conversations, searchTerm]);

  useLayoutEffect(() => {
    const input = draftInputRef.current;
    if (!input) return;

    input.style.height = "auto";
    const nextHeight = Math.min(input.scrollHeight, maxComposerHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxComposerHeight ? "auto" : "hidden";
  }, [draft]);

  function selectConversation(id: string, record = true): void {
    setActiveId(id);
    if (record) {
      setHistory((current) => {
        const next = [...current.slice(0, historyIndex + 1), id];
        setHistoryIndex(next.length - 1);
        return next;
      });
    }
    setNotice("Conversation selected");
  }

  function createChat(): void {
    const nextNumber = conversations.length + 1;
    const chat: Conversation = {
      id: `local-chat-${Date.now()}`,
      title: `New local chat ${nextNumber}`,
      when: "Now",
      messages: [
        {
          author: "Matey",
          tone: "assistant",
          text: "New local chat started. Type a message to continue.",
        },
      ],
    };
    setConversations((current) => [chat, ...current]);
    setActiveId(chat.id);
    setHistory((current) => {
      const next = [...current.slice(0, historyIndex + 1), chat.id];
      setHistoryIndex(next.length - 1);
      return next;
    });
    setNotice("New chat created");
  }

  function sendMessage(): void {
    const text = draft.trim();
    if (!text) {
      setNotice("Type a message first");
      return;
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeId
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                { author: "You", tone: "user", text },
                {
                  author: "Matey",
                  tone: "assistant",
                  text: `Local reply noted for “${text.slice(0, 48)}${text.length > 48 ? "…" : ""}”.`,
                },
              ],
            }
          : conversation,
      ),
    );
    setDraft("");
    setNotice("Message sent locally");
  }

  function submitComposer(event: FormEvent): void {
    event.preventDefault();
    sendMessage();
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <main
      className={`matey-shell${dimTheme ? " matey-shell--dim" : ""}`}
      aria-label="Matey desktop chat workspace"
    >
      <header className="app-titlebar app-titlebar--desktop" aria-label="Window titlebar">
        <div className="app-titlebar__menu" aria-label="Window navigation controls">
          <button
            className="app-titlebar__button"
            type="button"
            aria-label="Toggle sidebar"
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <SidebarPanelIcon />
          </button>
          <button
            className="app-titlebar__button app-titlebar__button--nav"
            type="button"
            aria-label="Back"
            disabled={!canGoBack}
            onClick={() => {
              if (canGoBack) {
                const next = historyIndex - 1;
                const id = history[next];
                if (id) {
                  setHistoryIndex(next);
                  selectConversation(id, false);
                }
              } else setNotice("No previous conversation");
            }}
          >
            ←
          </button>
          <button
            className="app-titlebar__button app-titlebar__button--nav"
            type="button"
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={() => {
              if (canGoForward) {
                const next = historyIndex + 1;
                const id = history[next];
                if (id) {
                  setHistoryIndex(next);
                  selectConversation(id, false);
                }
              } else setNotice("No next conversation");
            }}
          >
            →
          </button>
        </div>
        <div className="app-titlebar__spacer" aria-hidden="true" />
        <div className="app-titlebar__toolbar" aria-label="Window controls">
          <button
            className="titlebar-commit-button"
            type="button"
            aria-label="Commit current changes"
            onClick={() => setNotice("Commit staged locally")}
          >
            Commit
          </button>
        </div>
      </header>

      <div className="matey-layout">
        {sidebarOpen && (
          <aside className="layout-sider" aria-label="Primary navigation" data-width="250">
            <div className="layout-sider-content">
              <nav className="sider-top-nav" aria-label="Chat shortcuts">
                <div className="sider-toolbar">
                  <button
                    className="sider-action sider-action--primary"
                    type="button"
                    aria-label="New chat"
                    onClick={createChat}
                  >
                    <span className="sider-action__icon" aria-hidden="true">
                      <span className="sider-action__plus">＋</span>
                    </span>
                    <span>New chat</span>
                  </button>
                  <button
                    className="sider-icon-action"
                    type="button"
                    aria-label="Manage chats"
                    aria-pressed={managementMode}
                    onClick={() => setManagementMode((mode) => !mode)}
                  >
                    ☷
                  </button>
                </div>
                <button
                  className="sider-search-entry"
                  type="button"
                  aria-label="Search conversations"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen((open) => !open)}
                >
                  <span className="sider-row-icon">
                    <SearchIcon />
                  </span>
                  <span>Search</span>
                </button>
                {searchOpen && (
                  <input
                    className="sider-search-input"
                    aria-label="Conversation search input"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Filter chats"
                  />
                )}
                <button
                  className="sider-scheduled-entry"
                  type="button"
                  aria-label="Scheduled items"
                  aria-expanded={scheduledOpen}
                  onClick={() => setScheduledOpen((open) => !open)}
                >
                  <span className="sider-row-icon">
                    <ScheduledIcon />
                  </span>
                  <span>Scheduled</span>
                </button>
                {scheduledOpen && (
                  <div className="local-panel" role="status">
                    No scheduled items. Local reminders can be staged here.
                  </div>
                )}
                <div className="sider-divider" />
              </nav>
              <section className="sider-scroll-area" aria-label="Recent conversations">
                <p className="sider-section-label">Recent{managementMode ? " · Manage" : ""}</p>
                {filteredConversations.map((conversation) => (
                  <button
                    className={
                      conversation.id === activeId
                        ? "history-row history-row--active"
                        : "history-row"
                    }
                    key={conversation.id}
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
                  >
                    <span>{conversation.title}</span>
                    <small>{managementMode ? "Local only" : conversation.when}</small>
                  </button>
                ))}
              </section>
            </div>
            <footer className="sider-footer" aria-label="Sidebar footer">
              <button
                className="sider-footer-row"
                type="button"
                aria-label="Settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <span className="sider-row-icon">
                  <SettingsIcon />
                </span>
                <span>Settings</span>
              </button>
              <button
                className="sider-footer-row sider-footer-row--icon"
                type="button"
                aria-label="Theme"
                aria-pressed={dimTheme}
                onClick={() => setDimTheme((dim) => !dim)}
              >
                ◐
              </button>
            </footer>
            {settingsOpen && (
              <div className="floating-panel" role="status">
                Settings panel is local for this session.
              </div>
            )}
          </aside>
        )}

        <section className="layout-content" aria-label="Main chat">
          <header className="chat-layout-header chat-layout-header--glass" aria-label="Chat header">
            <div className="chat-title-block">
              <h1>{activeConversation.title}</h1>
              <p>{activeConversation.messages.length} local messages</p>
            </div>
            <div className="chat-header-actions" aria-label="Conversation controls">
              <button
                className="workspace-toggle"
                type="button"
                aria-label="Toggle workspace"
                aria-pressed={workspaceOpen}
                onClick={() => setWorkspaceOpen((open) => !open)}
              >
                ⇥
              </button>
            </div>
          </header>
          <section className="conversation-body" aria-label="Message stream">
            <div className="message-list">
              {activeConversation.messages.map((message, index) => (
                <article
                  className={`message message--${message.tone}`}
                  key={`${message.author}-${index}-${message.text}`}
                >
                  <div className="message-content">
                    {message.tone === "assistant" && (
                      <p className="message-author">{message.author}</p>
                    )}
                    <p className="message-text">{message.text}</p>
                  </div>
                </article>
              ))}
            </div>
            {workspaceOpen && (
              <aside className="workspace-panel" aria-label="Workspace preview">
                <strong>Workspace preview</strong>
                <p>{activeConversation.title}</p>
                <p>{notice}</p>
              </aside>
            )}
          </section>
          <form className="sendbox-panel" aria-label="Message composer" onSubmit={submitComposer}>
            {(attached || listening) && (
              <div className="sendbox-context-row" aria-label="Composer context">
                {attached && (
                  <button
                    className="attachment-chip"
                    type="button"
                    aria-label="Remove local attachment"
                    onClick={() => setAttached(false)}
                  >
                    <span>Local attachment ready</span>
                    <span className="attachment-chip__close" aria-hidden="true">
                      ×
                    </span>
                  </button>
                )}
                {listening && (
                  <span className="listening-indicator" role="status">
                    Listening locally…
                  </span>
                )}
              </div>
            )}
            {moreOpen && (
              <div className="more-menu" role="menu">
                <button type="button" role="menuitem">
                  Copy summary
                </button>
                <button type="button" role="menuitem">
                  Clear draft
                </button>
              </div>
            )}
            <textarea
              ref={draftInputRef}
              className="sendbox-textarea"
              aria-label="Message input"
              placeholder="Ask Matey anything..."
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleDraftKeyDown}
            />
            <div className="sendbox-bottom-row">
              <div className="sendbox-tools" aria-label="Composer tools">
                <button
                  className="sendbox-tool-pill"
                  type="button"
                  aria-label="Attach file"
                  aria-pressed={attached}
                  onClick={() => setAttached((value) => !value)}
                >
                  ＋ Add
                </button>
                <button
                  className="sendbox-model-pill"
                  type="button"
                  aria-label="Model selector"
                  onClick={() => setModelIndex((index) => (index + 1) % models.length)}
                >
                  {models[modelIndex]} ▾
                </button>
              </div>
              <div className="sendbox-actions" aria-label="Composer actions">
                <button
                  className="sendbox-circle-button"
                  type="button"
                  aria-label="Voice input"
                  aria-pressed={listening}
                  onClick={() => setListening((value) => !value)}
                >
                  ◌
                </button>
                <button
                  className="sendbox-circle-button"
                  type="button"
                  aria-label="More actions"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((value) => !value)}
                >
                  ⋯
                </button>
                <button
                  className="sendbox-send-button"
                  type="submit"
                  aria-label="Send message"
                  disabled={!canSend}
                >
                  ↑
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
