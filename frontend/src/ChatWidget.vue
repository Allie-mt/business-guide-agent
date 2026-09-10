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

const md = new MarkdownIt({ breaks: true, linkify: true });

const open = ref(false);
const messages = ref<ChatMsg[]>([]);
const input = ref("");
const loading = ref(false);
const sessionId = ref<string | null>(null);
const streaming = ref(true);
const screenshotUrl = ref<string | undefined>();
const screenshotPreview = ref<string | null>(null);

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

async function handleSend() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  const userMsg: ChatMsg = {
    id: uuid(),
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMsg);
  input.value = "";
  loading.value = true;

  const currentScreenshotUrl = screenshotUrl.value;
  removeScreenshot();

  try {
    const sid = await ensureSession();

    if (streaming.value) {
      const assistantId = uuid();
      const assistantMsg: ChatMsg = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      messages.value.push(assistantMsg);

      for await (const chunk of client.value.streamMessage(
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
        } catch {
          // not JSON, use raw text
        }
        const target = messages.value.find((m) => m.id === assistantId);
        if (target) target.content += textContent;
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
    messages.value.push({
      id: uuid(),
      role: "assistant",
      content: `⚠️ 请求失败: ${(err as Error).message}`,
      timestamp: Date.now(),
    });
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
</script>

<template>
  <button
    v-if="!open"
    class="bga-fab"
    :style="{
      right: config.position === 'bottom-left' ? undefined : '24px',
      left: config.position === 'bottom-left' ? '24px' : undefined,
    }"
    @click="open = true"
  >
    💬
  </button>

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
      <span class="bga-title">{{ config.title || "业务指引助手" }}</span>
      <div class="bga-header-actions">
        <label class="bga-stream-toggle">
          <input v-model="streaming" type="checkbox" />
          <span>流式</span>
        </label>
        <button class="bga-close-btn" @click="open = false">✕</button>
      </div>
    </div>

    <div class="bga-messages">
      <div v-if="messages.length === 0" class="bga-empty">
        <div class="bga-empty-icon">🤖</div>
        <div>你好！我是业务指引助手，有什么可以帮你的？</div>
        <div class="bga-empty-hint">支持文字提问和系统截图分析</div>
      </div>

      <div
        v-for="msg in messages"
        :key="msg.id"
        class="bga-msg"
        :class="'bga-msg-' + msg.role"
      >
        <div class="bga-msg-bubble" :class="'bga-bubble-' + msg.role">
          <template v-if="msg.role === 'assistant'">
            <div v-html="renderMarkdown(msg.content)"></div>
          </template>
          <template v-else>
            {{ msg.content }}
          </template>
        </div>
        <div v-if="msg.metadata?.citations?.length" class="bga-citations">
          📎 来源:
          <span v-for="(c, i) in msg.metadata.citations" :key="i">
            <template v-if="i > 0">, </template>
            {{ c.source }}
            <template v-if="c.score !== undefined">
              ({{ (c.score * 100).toFixed(0) }}%)
            </template>
          </span>
        </div>
        <div
          v-if="msg.metadata?.hallucinationPassed !== undefined"
          class="bga-hallucination"
          :class="msg.metadata.hallucinationPassed ? 'bga-pass' : 'bga-fail'"
        >
          {{
            msg.metadata.hallucinationPassed
              ? "✓ 事实核验通过"
              : "⚠ 事实核验存疑"
          }}
        </div>
      </div>

      <div v-if="loading" class="bga-typing">
        <span class="bga-dots">● ● ●</span>
      </div>
      <div ref="bottomRef"></div>
    </div>

    <div v-if="screenshotPreview" class="bga-screenshot-bar">
      <img
        :src="screenshotPreview"
        alt="截图预览"
        class="bga-screenshot-preview"
      />
      <span class="bga-screenshot-label">📷 截图已附加</span>
      <button class="bga-screenshot-remove" @click="removeScreenshot">✕</button>
    </div>

    <div class="bga-input-bar">
      <button
        class="bga-attach-btn"
        title="上传截图"
        @click="fileInputRef?.click()"
      >
        📷
      </button>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        style="display: none"
        @change="handleScreenshotSelect"
      />
      <textarea
        ref="inputRef"
        v-model="input"
        class="bga-input"
        :placeholder="config.placeholder || '输入你的问题...'"
        rows="1"
        @keydown="handleKeyDown"
      />
      <button
        class="bga-send-btn"
        :disabled="loading || !input.trim()"
        @click="handleSend"
      >
        ➤
      </button>
    </div>
  </div>
</template>

<style>
@keyframes bga-pulse {
  0%,
  80%,
  100% {
    opacity: 0.2;
  }
  40% {
    opacity: 1;
  }
}

.bga-fab {
  position: fixed;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: #4f46e5;
  color: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: transform 0.2s;
}
.bga-fab:hover {
  transform: scale(1.1);
}

.bga-panel {
  position: fixed;
  bottom: 24px;
  width: 420px;
  height: 620px;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 9999;
  background-color: #fff;
  color: #1e1e2e;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.bga-panel.bga-dark {
  background-color: #1e1e2e;
  color: #cdd6f4;
}

.bga-header {
  padding: 14px 20px;
  background-color: #4f46e5;
  color: #fff;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.bga-title {
  font-weight: 600;
  font-size: 16px;
}
.bga-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.bga-stream-toggle {
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  color: #fff;
}
.bga-stream-toggle input {
  margin: 0;
}
.bga-close-btn {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 20px;
}

.bga-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bga-empty {
  text-align: center;
  color: #9ca3af;
  margin-top: 40px;
}
.bga-dark .bga-empty {
  color: #6c7086;
}
.bga-empty-icon {
  font-size: 40px;
  margin-bottom: 8px;
}
.bga-empty-hint {
  font-size: 12px;
  margin-top: 12px;
  opacity: 0.7;
}

.bga-msg {
  max-width: 85%;
}
.bga-msg-user {
  align-self: flex-end;
}
.bga-msg-assistant {
  align-self: flex-start;
}

.bga-msg-bubble {
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.bga-bubble-user {
  border-radius: 16px 16px 4px 16px;
  background-color: #4f46e5;
  color: #fff;
}
.bga-bubble-assistant {
  border-radius: 16px 16px 16px 4px;
  background-color: #f3f4f6;
  color: #1f2937;
}
.bga-dark .bga-bubble-assistant {
  background-color: #313244;
  color: #cdd6f4;
}

.bga-citations {
  margin-top: 4px;
  font-size: 11px;
  color: #9ca3af;
}
.bga-dark .bga-citations {
  color: #6c7086;
}

.bga-hallucination {
  margin-top: 2px;
  font-size: 10px;
}
.bga-hallucination.bga-pass {
  color: #22c55e;
}
.bga-hallucination.bga-fail {
  color: #ef4444;
}

.bga-typing {
  align-self: flex-start;
  padding: 10px 14px;
  font-size: 14px;
  color: #9ca3af;
}
.bga-dark .bga-typing {
  color: #6c7086;
}
.bga-dots {
  animation: bga-pulse 1.5s infinite;
}

.bga-screenshot-bar {
  padding: 8px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 8px;
}
.bga-dark .bga-screenshot-bar {
  border-top-color: #313244;
}
.bga-screenshot-preview {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #d1d5db;
}
.bga-dark .bga-screenshot-preview {
  border-color: #45475a;
}
.bga-screenshot-label {
  font-size: 12px;
  flex: 1;
  opacity: 0.7;
}
.bga-screenshot-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: #9ca3af;
}
.bga-dark .bga-screenshot-remove {
  color: #6c7086;
}

.bga-input-bar {
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 8px;
}
.bga-dark .bga-input-bar {
  border-top-color: #313244;
}

.bga-attach-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background-color: transparent;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  flex-shrink: 0;
}
.bga-dark .bga-attach-btn {
  border-color: #45475a;
  color: #6c7086;
}

.bga-input {
  flex: 1;
  resize: none;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
  background-color: #fff;
  color: #1f2937;
  font-family: inherit;
}
.bga-dark .bga-input {
  border-color: #45475a;
  background-color: #1e1e2e;
  color: #cdd6f4;
}

.bga-send-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: none;
  background-color: #4f46e5;
  color: #fff;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
  flex-shrink: 0;
}
.bga-send-btn:disabled {
  background-color: #9ca3af;
  cursor: not-allowed;
}
</style>
