<script setup lang="ts">
import { ref, shallowRef, watch, nextTick, computed } from "vue";
import MarkdownIt from "markdown-it";
import type { ChatMessage as ChatMsg, BGAWidgetConfig } from "./types";
import { ApiClient } from "./api";

function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const props = defineProps<{
  config: BGAWidgetConfig;
}>();

const md = new MarkdownIt({
  breaks: true,
  linkify: true,
  typographer: true,
  html: false,
});

const open = ref(false);
const messages = ref<ChatMsg[]>([]);
const input = ref("");
const loading = ref(false);
const sessionId = ref<string | null>(null);
const streaming = ref(true);
const screenshotUrl = ref<string | undefined>();
const screenshotPreview = ref<string | null>(null);
const abortController = ref<AbortController | null>(null);

const bottomRef = ref<HTMLDivElement>();
const inputRef = ref<HTMLTextAreaElement>();
const fileInputRef = ref<HTMLInputElement>();

const client = shallowRef(new ApiClient(props.config));

const isDark = computed(() => props.config.theme === "dark");

watch(
  () => messages.value.length,
  () => {
    nextTick(() => {
      bottomRef.value?.scrollIntoView({ behavior: "smooth" });
    });
  },
);

async function ensureSession(): Promise<string> {
  if (sessionId.value) return sessionId.value;
  const { id } = await client.value.createSession(props.config.projectId);
  sessionId.value = id;
  return id;
}

function handleScreenshotSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    screenshotPreview.value = ev.target?.result as string;
  };
  reader.readAsDataURL(file);

  if (props.config.apiUrl) {
    client.value
      .uploadScreenshot(file)
      .then((url) => (screenshotUrl.value = url))
      .catch(() => (screenshotUrl.value = undefined));
  }
}

function removeScreenshot() {
  screenshotUrl.value = undefined;
  screenshotPreview.value = null;
  if (fileInputRef.value) fileInputRef.value.value = "";
}

function handleStop() {
  if (abortController.value) {
    abortController.value.abort();
    abortController.value = null;
  }
  loading.value = false;
}

async function handleSend() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  const currentScreenshotPreview = screenshotPreview.value;
  const currentScreenshotUrl = screenshotUrl.value;

  const userMsg: ChatMsg = {
    id: uuid(),
    role: "user",
    content: text,
    timestamp: Date.now(),
    imageUrl: currentScreenshotPreview || undefined,
  };
  messages.value.push(userMsg);
  input.value = "";
  loading.value = true;
  removeScreenshot();

  try {
    const sid = await ensureSession();

    if (streaming.value) {
      const ac = new AbortController();
      abortController.value = ac;

      const assistantId = uuid();
      const assistantMsg: ChatMsg = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      messages.value.push(assistantMsg);

      try {
        let receivedTokens = false;
        for await (const chunk of client.value.streamMessage(
          sid,
          text,
          currentScreenshotUrl,
          ac.signal,
        )) {
          let textContent = "";
          let isToken = false;
          try {
            const parsed = JSON.parse(chunk);
            if (parsed.type === "token" && parsed.content) {
              textContent = parsed.content;
              isToken = true;
              receivedTokens = true;
            } else if (parsed.type === "answer" && parsed.content) {
              if (!receivedTokens) {
                textContent = parsed.content;
              }
            } else if (parsed.type === "error") {
              textContent = `⚠️ ${parsed.content || "未知错误"}`;
            } else if (
              parsed.type === "intent" ||
              parsed.type === "hallucination" ||
              parsed.type === "user_message"
            ) {
              continue;
            }
          } catch {
            // not JSON, use raw text
            textContent = chunk;
          }
          if (textContent) {
            const target = messages.value.find((m) => m.id === assistantId);
            if (target) target.content += textContent;
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          const target = messages.value.find((m) => m.id === assistantId);
          if (target && !target.content) {
            target.content = "⏹ 对话已终止";
          }
        } else {
          throw err;
        }
      } finally {
        abortController.value = null;
      }
    } else {
      const res = await client.value.sendMessage(
        sid,
        text,
        currentScreenshotUrl,
      );
      const assistantMsg: ChatMsg = {
        id: uuid(),
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
      messages.value.push(assistantMsg);
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      messages.value.push({
        id: uuid(),
        role: "assistant",
        content: `⚠️ 请求失败: ${(err as Error).message}`,
        timestamp: Date.now(),
      });
    }
  } finally {
    loading.value = false;
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function renderMarkdown(content: string): string {
  return md.render(content);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
</script>

<template>
  <Transition name="bga-fab-transition">
    <button
      v-if="!open"
      class="bga-fab"
      :style="{
        right: config.position === 'bottom-left' ? undefined : '24px',
        left: config.position === 'bottom-left' ? '24px' : undefined,
      }"
      @click="open = true"
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        />
      </svg>
    </button>
  </Transition>

  <Transition name="bga-panel-transition">
    <div
      v-if="open"
      class="bga-panel"
      :class="{ 'bga-dark': isDark }"
      :style="{
        right: config.position === 'bottom-left' ? undefined : '24px',
        left: config.position === 'bottom-left' ? '24px' : undefined,
      }"
    >
      <div class="bga-header">
        <div class="bga-header-left">
          <div class="bga-avatar">AI</div>
          <div class="bga-header-text">
            <span class="bga-title">{{ config.title || "业务指引助手" }}</span>
            <span class="bga-status">在线</span>
          </div>
        </div>
        <div class="bga-header-actions">
          <label class="bga-stream-toggle" :class="{ active: streaming }">
            <input v-model="streaming" type="checkbox" />
            <span class="bga-toggle-track"
              ><span class="bga-toggle-thumb"></span
            ></span>
            <span class="bga-toggle-label">流式</span>
          </label>
          <button class="bga-close-btn" @click="open = false">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div class="bga-messages">
        <div v-if="messages.length === 0" class="bga-empty">
          <div class="bga-empty-avatar">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
              <path d="M12 16v-1" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
              <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4" />
            </svg>
          </div>
          <div class="bga-empty-title">你好！我是业务指引助手</div>
          <div class="bga-empty-desc">
            有任何业务问题都可以问我，支持文字提问和系统截图分析
          </div>
          <div class="bga-empty-tips">
            <div class="bga-empty-tip">💬 输入问题获取指引</div>
            <div class="bga-empty-tip">📷 上传截图分析界面</div>
            <div class="bga-empty-tip">📚 基于项目知识库回答</div>
          </div>
        </div>

        <TransitionGroup name="bga-msg-anim">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="bga-msg"
            :class="'bga-msg-' + msg.role"
          >
            <div
              v-if="msg.role === 'assistant'"
              class="bga-msg-avatar bga-msg-avatar-ai"
            >
              AI
            </div>
            <div class="bga-msg-body">
              <div v-if="msg.imageUrl" class="bga-msg-image">
                <img
                  :src="msg.imageUrl"
                  alt="截图"
                  class="bga-attached-image"
                />
              </div>
              <div class="bga-msg-bubble" :class="'bga-bubble-' + msg.role">
                <template v-if="msg.role === 'assistant'">
                  <div v-if="!msg.content" class="bga-bubble-loading">
                    <span></span><span></span><span></span>
                  </div>
                  <div v-else v-html="renderMarkdown(msg.content)"></div>
                </template>
                <template v-else>
                  {{ msg.content }}
                </template>
              </div>
              <div class="bga-msg-meta">
                <span
                  v-if="msg.content || msg.role !== 'assistant'"
                  class="bga-msg-time"
                  >{{ formatTime(msg.timestamp) }}</span
                >
              </div>
              <div
                v-if="false && msg.metadata?.citations?.length"
                class="bga-citations-card"
              >
                <div
                  class="bga-citations-header"
                  @click="
                    msg._citationsOpen = !msg._citationsOpen;
                    messages = [...messages];
                  "
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                    />
                    <path
                      d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                    />
                  </svg>
                  <span>引用来源 ({{ msg.metadata.citations.length }})</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="bga-chevron"
                    :class="{ open: msg._citationsOpen }"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <div v-if="msg._citationsOpen" class="bga-citations-list">
                  <div
                    v-for="(c, i) in msg.metadata.citations"
                    :key="i"
                    class="bga-citation-item"
                  >
                    <span
                      class="bga-citation-type"
                      :class="'bga-ct-' + c.type"
                      >{{ c.type === "document" ? "📄" : "🔗" }}</span
                    >
                    <span class="bga-citation-source">{{ c.source }}</span>
                    <span
                      v-if="c.score !== undefined"
                      class="bga-citation-score"
                    >
                      {{ (c.score * 100).toFixed(0) }}%</span
                    >
                  </div>
                </div>
              </div>
            </div>
            <div
              v-if="msg.role === 'user'"
              class="bga-msg-avatar bga-msg-avatar-user"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          </div>
        </TransitionGroup>

        <div
          v-if="
            loading &&
            (messages.length === 0 ||
              messages[messages.length - 1]?.role !== 'assistant')
          "
          class="bga-typing"
        >
          <div class="bga-msg-avatar bga-msg-avatar-ai">AI</div>
          <div class="bga-typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div ref="bottomRef"></div>
      </div>

      <div v-if="screenshotPreview" class="bga-screenshot-bar">
        <img
          :src="screenshotPreview"
          alt="截图预览"
          class="bga-screenshot-thumb"
        />
        <div class="bga-screenshot-info">
          <span class="bga-screenshot-label">截图已附加</span>
          <span class="bga-screenshot-hint">发送时将一并提交</span>
        </div>
        <button class="bga-screenshot-remove" @click="removeScreenshot">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="bga-input-bar">
        <button
          class="bga-attach-btn"
          title="上传截图"
          @click="fileInputRef?.click()"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleScreenshotSelect"
        />
        <div class="bga-input-wrap">
          <textarea
            ref="inputRef"
            v-model="input"
            class="bga-input"
            :placeholder="config.placeholder || '输入你的问题...'"
            rows="1"
            @keydown="handleKeyDown"
          />
          <Transition name="bga-btn-swap" mode="out-in">
            <button
              v-if="loading"
              key="stop"
              class="bga-action-btn bga-stop-btn"
              title="终止对话"
              @click="handleStop"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
            <button
              v-else
              key="send"
              class="bga-action-btn bga-send-btn"
              :disabled="!input.trim()"
              @click="handleSend"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style>
@keyframes bga-dot-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-6px);
  }
}

.bga-msg-anim-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bga-msg-anim-leave-active {
  transition: all 0.2s ease-in;
}
.bga-msg-anim-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}
.bga-msg-anim-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

.bga-fab-transition-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bga-fab-transition-leave-active {
  transition: all 0.2s ease-in;
}
.bga-fab-transition-enter-from {
  transform: scale(0);
  opacity: 0;
}
.bga-fab-transition-leave-to {
  transform: scale(0.8);
  opacity: 0;
}

.bga-panel-transition-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bga-panel-transition-leave-active {
  transition: all 0.25s ease-in;
}
.bga-panel-transition-enter-from {
  transform: scale(0.9) translateY(20px);
  opacity: 0;
}
.bga-panel-transition-leave-to {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

.bga-btn-swap-enter-active {
  transition: all 0.2s ease;
}
.bga-btn-swap-leave-active {
  transition: all 0.15s ease;
}
.bga-btn-swap-enter-from {
  transform: scale(0.8);
  opacity: 0;
}
.bga-btn-swap-leave-to {
  transform: scale(0.8);
  opacity: 0;
}

.bga-fab {
  position: fixed;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 50%, #4f46e5 100%);
  color: #fff;
  border: none;
  cursor: pointer;
  box-shadow:
    0 4px 20px rgba(79, 70, 229, 0.45),
    0 0 0 4px rgba(99, 102, 241, 0.1);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}
.bga-fab:hover {
  transform: scale(1.08);
  box-shadow:
    0 6px 28px rgba(79, 70, 229, 0.55),
    0 0 0 6px rgba(99, 102, 241, 0.15);
}
.bga-fab:active {
  transform: scale(0.95);
}

.bga-panel {
  position: fixed;
  bottom: 24px;
  width: 420px;
  height: 640px;
  border-radius: 22px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.12),
    0 8px 24px rgba(0, 0, 0, 0.08),
    0 0 0 1px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 9999;
  background-color: #ffffff;
  color: #1e293b;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
    sans-serif;
}
.bga-panel.bga-dark {
  background-color: #0f172a;
  color: #e2e8f0;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.4),
    0 8px 24px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.04);
}

.bga-header {
  padding: 12px 16px;
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 40%, #4f46e5 100%);
  color: #fff;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(79, 70, 229, 0.15);
}
.bga-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bga-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.bga-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bga-title {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.2;
}
.bga-status {
  font-size: 10px;
  opacity: 0.8;
  display: flex;
  align-items: center;
  gap: 4px;
}
.bga-status::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #4ade80;
  display: inline-block;
}
.bga-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.bga-stream-toggle {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  user-select: none;
}
.bga-stream-toggle input {
  display: none;
}
.bga-toggle-track {
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.25);
  position: relative;
  transition: background 0.2s;
  display: block;
}
.bga-stream-toggle.active .bga-toggle-track {
  background: rgba(255, 255, 255, 0.5);
}
.bga-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  display: block;
}
.bga-stream-toggle.active .bga-toggle-thumb {
  transform: translateX(12px);
}
.bga-toggle-label {
  font-size: 11px;
}
.bga-close-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.bga-close-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.bga-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}
.bga-messages::-webkit-scrollbar {
  width: 5px;
}
.bga-messages::-webkit-scrollbar-track {
  background: transparent;
}
.bga-messages::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 6px;
}
.bga-dark .bga-messages::-webkit-scrollbar-thumb {
  background: #334155;
}

.bga-empty {
  text-align: center;
  color: #94a3b8;
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.bga-dark .bga-empty {
  color: #64748b;
}
.bga-empty-avatar {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: linear-gradient(135deg, #e0e7ff, #c7d2fe);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
  color: #6366f1;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.12);
}
.bga-dark .bga-empty-avatar {
  background: linear-gradient(135deg, #1e1b4b, #312e81);
  color: #818cf8;
  box-shadow: 0 4px 16px rgba(129, 140, 248, 0.1);
}
.bga-empty-title {
  font-size: 15px;
  font-weight: 700;
  color: #334155;
}
.bga-dark .bga-empty-title {
  color: #e2e8f0;
}
.bga-empty-desc {
  font-size: 12px;
  max-width: 240px;
  line-height: 1.5;
}
.bga-empty-tips {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bga-empty-tip {
  font-size: 11px;
  padding: 6px 14px;
  background: #f1f5f9;
  border-radius: 8px;
  color: #64748b;
  border: 1px solid #e2e8f0;
  transition: all 0.15s;
}
.bga-empty-tip:hover {
  background: #e0e7ff;
  border-color: #c7d2fe;
  color: #4f46e5;
}
.bga-dark .bga-empty-tip {
  background: #1e293b;
  color: #94a3b8;
  border-color: #334155;
}
.bga-dark .bga-empty-tip:hover {
  background: #1e1b4b;
  border-color: #312e81;
  color: #818cf8;
}

.bga-msg {
  display: flex;
  gap: 8px;
  max-width: 92%;
}
.bga-msg-user {
  align-self: flex-end;
}
.bga-msg-assistant {
  align-self: flex-start;
}
.bga-msg-avatar {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
}
.bga-msg-avatar-ai {
  background: linear-gradient(135deg, #e0e7ff, #c7d2fe);
  color: #4f46e5;
  box-shadow: 0 1px 4px rgba(99, 102, 241, 0.12);
}
.bga-dark .bga-msg-avatar-ai {
  background: linear-gradient(135deg, #1e1b4b, #312e81);
  color: #818cf8;
  box-shadow: 0 1px 4px rgba(129, 140, 248, 0.08);
}
.bga-msg-avatar-user {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  box-shadow: 0 1px 4px rgba(79, 70, 229, 0.15);
}
.bga-msg-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bga-msg-image {
  margin-bottom: 2px;
}
.bga-attached-image {
  max-width: 220px;
  max-height: 160px;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid #e2e8f0;
  cursor: pointer;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}
.bga-attached-image:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.bga-dark .bga-attached-image {
  border-color: #334155;
}

.bga-msg-bubble {
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.bga-bubble-user {
  border-radius: 16px 16px 4px 16px;
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 50%, #4f46e5 100%);
  color: #fff;
  box-shadow:
    0 2px 8px rgba(79, 70, 229, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}
.bga-bubble-assistant {
  border-radius: 12px;
  background: #f8fafc;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  padding: 10px 14px;
}
.bga-dark .bga-bubble-assistant {
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid #334155;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.bga-bubble-assistant :deep(p) {
  margin: 0 0 8px 0;
  line-height: 1.7;
}
.bga-bubble-assistant :deep(p:last-child) {
  margin-bottom: 0;
}
.bga-bubble-assistant :deep(ul),
.bga-bubble-assistant :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.bga-bubble-assistant :deep(ul) {
  list-style: none;
  padding-left: 14px;
}
.bga-bubble-assistant :deep(ul > li) {
  position: relative;
  padding-left: 14px;
  margin: 3px 0;
  line-height: 1.6;
}
.bga-bubble-assistant :deep(ul > li::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #6366f1;
}
.bga-dark .bga-bubble-assistant :deep(ul > li::before) {
  background: #818cf8;
}
.bga-bubble-assistant :deep(ol) {
  counter-reset: bga-ol;
  list-style: none;
  padding-left: 14px;
}
.bga-bubble-assistant :deep(ol > li) {
  position: relative;
  padding-left: 22px;
  margin: 3px 0;
  line-height: 1.6;
  counter-increment: bga-ol;
}
.bga-bubble-assistant :deep(ol > li::before) {
  content: counter(bga-ol);
  position: absolute;
  left: 0;
  top: 1px;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: #e0e7ff;
  color: #4f46e5;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bga-dark .bga-bubble-assistant :deep(ol > li::before) {
  background: #1e1b4b;
  color: #818cf8;
}
.bga-bubble-assistant :deep(li) {
  margin: 3px 0;
  line-height: 1.6;
}
.bga-bubble-loading {
  display: flex;
  gap: 5px;
  padding: 2px 0;
  align-items: center;
}
.bga-bubble-loading span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6366f1;
  animation: bga-dot-bounce 1.4s ease-in-out infinite;
}
.bga-dark .bga-bubble-loading span {
  background: #818cf8;
}
.bga-bubble-loading span:nth-child(2) {
  animation-delay: 0.16s;
}
.bga-bubble-loading span:nth-child(3) {
  animation-delay: 0.32s;
}
.bga-bubble-assistant :deep(code) {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 12px;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
  color: #e11d48;
  border: 1px solid #e2e8f0;
}
.bga-dark .bga-bubble-assistant :deep(code) {
  background: #0f172a;
  color: #fb7185;
  border-color: #334155;
}
.bga-bubble-assistant :deep(pre) {
  background: #1e293b;
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
  border: 1px solid #334155;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  position: relative;
}
.bga-bubble-assistant :deep(pre::before) {
  content: "";
  display: block;
  height: 28px;
  background: #0f172a;
  border-bottom: 1px solid #334155;
  position: relative;
}
.bga-bubble-assistant :deep(pre::after) {
  content: "";
  position: absolute;
  top: 9px;
  left: 12px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow:
    12px 0 0 #fbbf24,
    24px 0 0 #22c55e;
}
.bga-bubble-assistant :deep(pre code) {
  background: none;
  border: none;
  padding: 12px 16px;
  color: #e2e8f0;
  font-size: 12px;
  display: block;
  overflow-x: auto;
  line-height: 1.6;
}
.bga-dark .bga-bubble-assistant :deep(pre code) {
  color: #e2e8f0;
}
.bga-bubble-assistant :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 14px;
  border-left: 3px solid #6366f1;
  background: linear-gradient(135deg, #f1f5f9 0%, #e8eef6 100%);
  border-radius: 0 10px 10px 0;
  color: #475569;
  font-size: 13px;
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.06);
}
.bga-dark .bga-bubble-assistant :deep(blockquote) {
  border-left-color: #818cf8;
  background: linear-gradient(135deg, #0f172a 0%, #1a1f3a 100%);
  color: #94a3b8;
  box-shadow: inset 0 0 0 1px rgba(129, 140, 248, 0.06);
}
.bga-bubble-assistant :deep(strong) {
  font-weight: 600;
  color: #1e293b;
}
.bga-dark .bga-bubble-assistant :deep(strong) {
  color: #f1f5f9;
}
.bga-bubble-assistant :deep(em) {
  color: #6366f1;
  font-style: italic;
}
.bga-dark .bga-bubble-assistant :deep(em) {
  color: #818cf8;
}
.bga-bubble-assistant :deep(h1),
.bga-bubble-assistant :deep(h2),
.bga-bubble-assistant :deep(h3) {
  margin: 12px 0 6px 0;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.3;
  padding-left: 10px;
  border-left: 3px solid #6366f1;
}
.bga-dark .bga-bubble-assistant :deep(h1),
.bga-dark .bga-bubble-assistant :deep(h2),
.bga-dark .bga-bubble-assistant :deep(h3) {
  color: #f1f5f9;
  border-left-color: #818cf8;
}
.bga-bubble-assistant :deep(h1) {
  font-size: 15px;
  padding-bottom: 4px;
  margin-bottom: 8px;
}
.bga-bubble-assistant :deep(h2) {
  font-size: 14px;
}
.bga-bubble-assistant :deep(h3) {
  font-size: 13.5px;
}
.bga-bubble-assistant :deep(a) {
  color: #6366f1;
  text-decoration: none;
  border-bottom: 1px dashed rgba(99, 102, 241, 0.4);
  transition: all 0.15s;
  padding-bottom: 1px;
}
.bga-bubble-assistant :deep(a:hover) {
  border-bottom-style: solid;
  border-bottom-color: #6366f1;
}
.bga-dark .bga-bubble-assistant :deep(a) {
  color: #818cf8;
  border-bottom-color: rgba(129, 140, 248, 0.4);
}
.bga-dark .bga-bubble-assistant :deep(a:hover) {
  border-bottom-color: #818cf8;
}
.bga-bubble-assistant :deep(hr) {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, #e2e8f0, transparent);
  margin: 10px 0;
}
.bga-dark .bga-bubble-assistant :deep(hr) {
  background: linear-gradient(90deg, transparent, #334155, transparent);
}
.bga-bubble-assistant :deep(table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 8px 0;
  font-size: 12px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}
.bga-bubble-assistant :deep(th),
.bga-bubble-assistant :deep(td) {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
}
.bga-bubble-assistant :deep(th) {
  background: #f1f5f9;
  font-weight: 600;
  color: #334155;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.bga-bubble-assistant :deep(tr:nth-child(even) td) {
  background: #f8fafc;
}
.bga-bubble-assistant :deep(tr:last-child td) {
  border-bottom: none;
}
.bga-dark .bga-bubble-assistant :deep(table) {
  border-color: #334155;
}
.bga-dark .bga-bubble-assistant :deep(th),
.bga-dark .bga-bubble-assistant :deep(td) {
  border-bottom-color: #334155;
}
.bga-dark .bga-bubble-assistant :deep(th) {
  background: #0f172a;
  color: #e2e8f0;
}
.bga-dark .bga-bubble-assistant :deep(tr:nth-child(even) td) {
  background: #1e293b;
}

.bga-msg-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #94a3b8;
  padding: 0 2px;
}
.bga-dark .bga-msg-meta {
  color: #64748b;
}
.bga-msg-time {
  opacity: 0.7;
}
.bga-meta-divider {
  opacity: 0.4;
}
.bga-citations {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.bga-citations-card {
  margin-top: 4px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  font-size: 11px;
  max-width: 260px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.bga-dark .bga-citations-card {
  border-color: #334155;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.bga-citations-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  cursor: pointer;
  color: #64748b;
  user-select: none;
  transition: background 0.15s;
}
.bga-citations-header:hover {
  background: #f1f5f9;
}
.bga-dark .bga-citations-header {
  background: #1e293b;
  color: #94a3b8;
}
.bga-dark .bga-citations-header:hover {
  background: #334155;
}
.bga-chevron {
  margin-left: auto;
  transition: transform 0.2s;
}
.bga-chevron.open {
  transform: rotate(180deg);
}
.bga-citations-list {
  padding: 3px 10px 5px;
  border-top: 1px solid #e2e8f0;
}
.bga-dark .bga-citations-list {
  border-top-color: #334155;
}
.bga-citation-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  color: #475569;
}
.bga-dark .bga-citation-item {
  color: #94a3b8;
}
.bga-citation-type {
  flex-shrink: 0;
  font-size: 13px;
}
.bga-citation-source {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bga-citation-score {
  flex-shrink: 0;
  color: #6366f1;
  font-weight: 600;
  font-size: 11px;
}
.bga-dark .bga-citation-score {
  color: #818cf8;
}
.bga-hallucination.bga-pass {
  color: #22c55e;
}
.bga-hallucination.bga-fail {
  color: #ef4444;
}

.bga-typing {
  display: flex;
  gap: 8px;
  align-self: flex-start;
  align-items: flex-start;
}
.bga-typing-dots {
  display: flex;
  gap: 4px;
  padding: 10px 14px;
  background: #f8fafc;
  border-radius: 16px 16px 16px 4px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.bga-dark .bga-typing-dots {
  background: #1e293b;
  border-color: #334155;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
.bga-typing-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6366f1;
  animation: bga-dot-bounce 1.4s ease-in-out infinite;
}
.bga-dark .bga-typing-dots span {
  background: #818cf8;
}
.bga-typing-dots span:nth-child(2) {
  animation-delay: 0.16s;
}
.bga-typing-dots span:nth-child(3) {
  animation-delay: 0.32s;
}

.bga-screenshot-bar {
  padding: 10px 16px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f8fafc;
  flex-shrink: 0;
}
.bga-dark .bga-screenshot-bar {
  border-top-color: #1e293b;
  background: #0f172a;
}
.bga-screenshot-thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 10px;
  border: 2px solid #e2e8f0;
}
.bga-dark .bga-screenshot-thumb {
  border-color: #334155;
}
.bga-screenshot-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.bga-screenshot-label {
  font-size: 13px;
  font-weight: 500;
  color: #334155;
}
.bga-dark .bga-screenshot-label {
  color: #e2e8f0;
}
.bga-screenshot-hint {
  font-size: 11px;
  color: #94a3b8;
}
.bga-screenshot-remove {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition:
    background 0.15s,
    color 0.15s;
}
.bga-screenshot-remove:hover {
  background: #fee2e2;
  color: #ef4444;
}
.bga-dark .bga-screenshot-remove:hover {
  background: rgba(239, 68, 68, 0.15);
}

.bga-input-bar {
  padding: 10px 14px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  gap: 6px;
  align-items: flex-end;
  flex-shrink: 0;
  background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
}
.bga-dark .bga-input-bar {
  border-top-color: #1e293b;
  background: linear-gradient(180deg, #0f172a 0%, #0c1322 100%);
}
.bga-attach-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: #f1f5f9;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  flex-shrink: 0;
  transition:
    background 0.15s,
    color 0.15s,
    box-shadow 0.15s;
  border: 1px solid transparent;
}
.bga-attach-btn:hover {
  background: #e0e7ff;
  color: #6366f1;
  border-color: #c7d2fe;
}
.bga-dark .bga-attach-btn {
  background: #1e293b;
  color: #64748b;
}
.bga-dark .bga-attach-btn:hover {
  background: #334155;
  color: #94a3b8;
}

.bga-input-wrap {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
  transition: box-shadow 0.2s;
  border: 1px solid transparent;
}
.bga-input-wrap:focus-within {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  background: #fff;
}
.bga-dark .bga-input-wrap {
  background: #1e293b;
}
.bga-dark .bga-input-wrap:focus-within {
  border-color: #818cf8;
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
  background: #0f172a;
}

.bga-input {
  flex: 1;
  resize: none;
  border: none;
  font-size: 13.5px;
  outline: none;
  background: transparent;
  color: #1e293b;
  font-family: inherit;
  line-height: 1.4;
  padding: 3px 0;
  max-height: 80px;
}
.bga-input::placeholder {
  color: #94a3b8;
}
.bga-dark .bga-input {
  color: #e2e8f0;
}
.bga-dark .bga-input::placeholder {
  color: #64748b;
}

.bga-action-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}
.bga-send-btn {
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 50%, #4f46e5 100%);
  color: #fff;
  box-shadow: 0 2px 10px rgba(79, 70, 229, 0.3);
}
.bga-send-btn:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
  transform: translateY(-1px);
}
.bga-send-btn:disabled {
  background: #cbd5e1;
  box-shadow: none;
  cursor: not-allowed;
  color: #fff;
}
.bga-dark .bga-send-btn:disabled {
  background: #334155;
}
.bga-stop-btn {
  background: #ef4444;
  color: #fff;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
}
.bga-stop-btn:hover {
  background: #dc2626;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}
</style>
