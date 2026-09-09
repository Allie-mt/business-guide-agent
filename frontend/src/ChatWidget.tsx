import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage, BGAWidgetConfig } from "./types";
import { ApiClient } from "./api";

interface Props {
  config: BGAWidgetConfig;
}

export function ChatWidget({ config }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);
  const [screenshotUrl, setScreenshotUrl] = useState<string | undefined>();
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const client = useRef(new ApiClient(config));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const { id } = await client.current.createSession(config.projectId);
    setSessionId(id);
    return id;
  }, [sessionId, config.projectId]);

  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setScreenshotPreview(dataUrl);
    };
    reader.readAsDataURL(file);

    if (config.apiUrl) {
      client.current
        .uploadScreenshot(file)
        .then((url) => setScreenshotUrl(url))
        .catch(() => setScreenshotUrl(undefined));
    }
  };

  const removeScreenshot = () => {
    setScreenshotUrl(undefined);
    setScreenshotPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const currentScreenshotUrl = screenshotUrl;
    removeScreenshot();

    try {
      const sid = await ensureSession();

      if (streaming) {
        const assistantId = crypto.randomUUID();
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        for await (const chunk of client.current.streamMessage(
          sid,
          text,
          currentScreenshotUrl,
        )) {
          let textContent = chunk;
          try {
            const parsed = JSON.parse(chunk);
            if (parsed.type === "answer" && parsed.content) {
              textContent = parsed.content;
            } else if (parsed.type === "error") {
              textContent = `⚠️ ${parsed.content || "未知错误"}`;
            } else if (
              parsed.type === "intent" ||
              parsed.type === "hallucination" ||
              parsed.type === "user_message"
            ) {
              continue;
            }
          } catch {}
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + textContent }
                : m,
            ),
          );
        }
      } else {
        const res = await client.current.sendMessage(
          sid,
          text,
          currentScreenshotUrl,
        );
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: res.content ?? res.answer ?? "",
          timestamp: Date.now(),
          metadata: {
            intent: res.metadata?.intent ?? res.intent,
            citations: res.metadata?.citations ?? res.citations,
            hallucinationPassed:
              res.metadata?.hallucinationPassed ?? res.hallucination_passed,
          },
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠️ 请求失败: ${(err as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isDark = config.theme === "dark";

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            bottom: 24,
            right: config.position === "bottom-left" ? undefined : 24,
            left: config.position === "bottom-left" ? 24 : undefined,
            width: 56,
            height: 56,
            borderRadius: "50%",
            backgroundColor: "#4f46e5",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(79,70,229,0.4)",
            fontSize: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            transition: "transform 0.2s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
          onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          💬
        </button>
      )}

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: config.position === "bottom-left" ? undefined : 24,
            left: config.position === "bottom-left" ? 24 : undefined,
            width: 420,
            height: 620,
            borderRadius: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 9999,
            backgroundColor: isDark ? "#1e1e2e" : "#fff",
            color: isDark ? "#cdd6f4" : "#1e1e2e",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div
            style={{
              padding: "14px 20px",
              backgroundColor: "#4f46e5",
              color: "#fff",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 16 }}>
              {config.title || "业务指引助手"}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label
                style={{
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={streaming}
                  onChange={(e) => setStreaming(e.target.checked)}
                  style={{ margin: 0 }}
                />
                流式
              </label>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 20,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: isDark ? "#6c7086" : "#9ca3af",
                  marginTop: 40,
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 8 }}>🤖</div>
                <div>你好！我是业务指引助手，有什么可以帮你的？</div>
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 12,
                    opacity: 0.7,
                  }}
                >
                  支持文字提问和系统截图分析
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius:
                      msg.role === "user"
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                    backgroundColor:
                      msg.role === "user"
                        ? "#4f46e5"
                        : isDark
                          ? "#313244"
                          : "#f3f4f6",
                    color:
                      msg.role === "user"
                        ? "#fff"
                        : isDark
                          ? "#cdd6f4"
                          : "#1f2937",
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.metadata?.citations &&
                  msg.metadata.citations.length > 0 && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: isDark ? "#6c7086" : "#9ca3af",
                      }}
                    >
                      📎 来源:{" "}
                      {msg.metadata.citations.map((c, i) => (
                        <span key={i}>
                          {i > 0 ? ", " : ""}
                          {c.source}
                          {c.score !== undefined &&
                            ` (${(c.score * 100).toFixed(0)}%)`}
                        </span>
                      ))}
                    </div>
                  )}
                {msg.metadata?.hallucinationPassed !== undefined && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      color: msg.metadata.hallucinationPassed
                        ? "#22c55e"
                        : "#ef4444",
                    }}
                  >
                    {msg.metadata.hallucinationPassed
                      ? "✓ 事实核验通过"
                      : "⚠ 事实核验存疑"}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 14px",
                  fontSize: 14,
                  color: isDark ? "#6c7086" : "#9ca3af",
                }}
              >
                <span
                  style={{
                    animation: "bga-pulse 1.5s infinite",
                  }}
                >
                  ● ● ●
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {screenshotPreview && (
            <div
              style={{
                padding: "8px 16px",
                borderTop: `1px solid ${isDark ? "#313244" : "#e5e7eb"}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <img
                src={screenshotPreview}
                alt="截图预览"
                style={{
                  width: 48,
                  height: 48,
                  objectFit: "cover",
                  borderRadius: 6,
                  border: `1px solid ${isDark ? "#45475a" : "#d1d5db"}`,
                }}
              />
              <span style={{ fontSize: 12, flex: 1, opacity: 0.7 }}>
                📷 截图已附加
              </span>
              <button
                onClick={removeScreenshot}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 16,
                  color: isDark ? "#6c7086" : "#9ca3af",
                }}
              >
                ✕
              </button>
            </div>
          )}

          <div
            style={{
              padding: "12px 16px",
              borderTop: `1px solid ${isDark ? "#313244" : "#e5e7eb"}`,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  border: `1px solid ${isDark ? "#45475a" : "#d1d5db"}`,
                  backgroundColor: "transparent",
                  cursor: "pointer",
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isDark ? "#6c7086" : "#9ca3af",
                }}
                title="上传截图"
              >
                📷
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleScreenshotSelect}
                style={{ display: "none" }}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={config.placeholder || "输入你的问题..."}
                rows={1}
                style={{
                  flex: 1,
                  resize: "none",
                  border: `1px solid ${isDark ? "#45475a" : "#d1d5db"}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 14,
                  outline: "none",
                  backgroundColor: isDark ? "#1e1e2e" : "#fff",
                  color: isDark ? "#cdd6f4" : "#1f2937",
                }}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  border: "none",
                  backgroundColor:
                    loading || !input.trim() ? "#9ca3af" : "#4f46e5",
                  color: "#fff",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background-color 0.2s",
                }}
              >
                ➤
              </button>
            </div>
          </div>

          <style>{`
            @keyframes bga-pulse {
              0%, 100% { opacity: 0.3; }
              50% { opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
