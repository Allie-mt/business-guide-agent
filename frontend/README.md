# Frontend — 前端界面

基于 React + TypeScript + Vite 的前端，分为两个独立部分：

1. **ChatWidget** — 嵌入式对话组件，供最终用户使用
2. **Admin Panel** — 独立管理后台，供管理员管理项目和文档

---

## ChatWidget 对话组件

**文件：** `src/ChatWidget.tsx`

可嵌入到任意项目中的对话气泡组件，提供完整的对话交互能力。

### 功能

- 浮动气泡按钮，点击展开/收起对话面板
- 消息列表展示（支持 ReactMarkdown 渲染）
- SSE 流式接收回答（逐字显示效果）
- 截图上传（多模态对话，支持预览和删除）
- 自动创建/复用会话
- 消息自动滚动到底部

### 组件接口

```tsx
interface Props {
  config: BGAWidgetConfig;
}

export function ChatWidget({ config }: Props)
```

### 配置接口（BGAWidgetConfig）

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| apiUrl | string | 是 | — | Backend API 地址（如 `http://localhost:3000`） |
| projectId | string | 是 | — | 项目ID，决定使用的知识库范围 |
| token | string | 否 | — | JWT Token（用于认证接口） |
| theme | "light" \| "dark" | 否 | — | 主题风格 |
| position | "bottom-right" \| "bottom-left" | 否 | — | 气泡位置 |
| title | string | 否 | — | 对话面板标题 |
| placeholder | string | 否 | — | 输入框占位文本 |

### 使用方式

```tsx
import { ChatWidget } from "./src";

<ChatWidget config={{
  apiUrl: "http://localhost:3000",
  projectId: "966ce4f1-b36a-4e9c-813c-343cca323caa",
}} />
```

### URL 参数切换项目

通过 URL 参数 `?projectId=xxx` 可动态切换项目，实现同一组件服务不同项目的知识库：

```
http://localhost:5173/?projectId=project-a-uuid   → 使用项目 A 的知识库
http://localhost:5173/?projectId=project-b-uuid   → 使用项目 B 的知识库
```

### 内部状态

| 状态 | 类型 | 说明 |
|------|------|------|
| open | boolean | 对话面板是否展开 |
| messages | ChatMessage[] | 消息列表 |
| input | string | 输入框内容 |
| loading | boolean | 是否正在等待回复 |
| sessionId | string \| null | 当前会话ID |
| streaming | boolean | 是否使用流式模式（默认 true） |
| screenshotUrl | string \| undefined | 已上传截图的 URL |
| screenshotPreview | string \| null | 截图预览 DataURL |

### 核心方法

| 方法 | 说明 |
|------|------|
| `ensureSession()` | 确保会话存在，不存在则创建 |
| `handleScreenshotSelect(e)` | 选择截图文件，预览并上传到 Backend |
| `removeScreenshot()` | 移除截图预览和 URL |
| `handleSend()` | 发送消息：创建用户消息 → 调用 API → 接收回复 |

### SSE 流式接收逻辑

```
1. 创建 assistant 消息（空内容）
2. 调用 client.streamMessage() 获取 AsyncGenerator
3. 逐 chunk 解析：
   - JSON 格式 {"type": "answer", "content": "..."} → 追加内容
   - 纯文本 → 直接追加
4. 更新 assistant 消息内容（逐字显示效果）
5. 流结束后标记 loading = false
```

---

## Admin 管理后台

**文件：** `admin.html`

独立的管理后台页面（纯 HTML + JS，不依赖 React 构建），用于项目和文档管理。

### 功能

- **项目管理**
  - 项目列表展示（名称、描述、创建时间）
  - 新建项目（内联输入框 + 按钮）
  - 项目切换（点击项目跳转到对话页面，URL 带上 projectId）

- **文档管理**
  - 文档上传（选择文件 + 上传按钮）
  - 文档列表展示（文件名、摄取状态、分块数、上传时间）
  - 手动触发文档摄取
  - 文档删除

- **导航**
  - 返回对话界面链接
  - 管理后台标题栏

### API 地址配置

通过全局变量 `window.__BGA_API_URL__` 注入 API 地址，默认 `http://localhost:3000`：

```html
<script>
  window.__BGA_API_URL__ = "https://your-api.example.com";
</script>
```

此方式适用于非模块脚本（admin.html 不使用 Vite 构建，无法使用 `import.meta.env`）。

### 项目创建

使用内联输入框 + 按钮方式（避免浏览器安全策略阻止 `prompt()` 弹窗）：

```html
<input type="text" id="new-project-name" placeholder="输入项目名称" />
<button onclick="createProject()">+ 新建项目</button>
```

### 文档摄取状态

| 状态 | 显示 | 说明 |
|------|------|------|
| pending | 🟡 待处理 | 文档已上传，等待摄取 |
| processing | 🔄 处理中 | 正在执行摄取管线 |
| completed | ✅ 已完成 | 摄取成功，可正常检索 |
| failed | ❌ 失败 | 摄取失败，可重新触发 |

### URL 参数

| 参数 | 说明 |
|------|------|
| `projectId` | 预选项目ID，打开页面后自动选中该项目 |

---

## API Client

**文件：** `src/api.ts`

`ApiClient` 类，封装与 Backend 的所有 HTTP 交互。

### 构造函数

```typescript
constructor(config: BGAWidgetConfig)
```

从 config 中提取 `apiUrl` 和 `token`。

### 方法

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `createSession(projectId)` | 项目ID | `Promise<{id: string}>` | 创建会话 |
| `sendMessage(sessionId, content, imageUrl?)` | 会话ID, 内容, 截图URL | `Promise<ChatResponse>` | 发送消息（非流式） |
| `streamMessage(sessionId, content, imageUrl?)` | 会话ID, 内容, 截图URL | `AsyncGenerator<string>` | 流式发送消息（SSE） |
| `uploadScreenshot(file)` | File 对象 | `Promise<string>` | 上传截图，返回 URL |

### 响应解包

Backend 所有响应格式为：

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-09-09T12:00:00.000Z"
}
```

`unwrap<T>(res)` 方法：
1. 检查 `res.ok`，非 2xx 状态码抛出错误
2. 解析 JSON
3. 返回 `data` 字段

### SSE 流式读取

`streamMessage()` 方法实现：

```typescript
async *streamMessage(sessionId, content, imageUrl?): AsyncGenerator<string> {
  // 1. POST 请求 /api/v1/chat/stream
  const res = await fetch(url, { method: "POST", body: ... });

  // 2. 获取 ReadableStream reader
  const reader = res.body.getReader();

  // 3. 逐 chunk 读取并解析 SSE
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // 4. 按 \n 分割，提取 "data: " 开头的行
    const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

    // 5. yield 每个 data 内容
    for (const line of lines) {
      yield line.slice(6);  // 去掉 "data: " 前缀
    }
  }
}
```

### 请求头

| 头 | 说明 |
|----|------|
| Content-Type | application/json |
| Authorization | Bearer {token}（如果配置了 token） |

---

## Types 类型定义

**文件：** `src/types.ts`

### BGAWidgetConfig

组件配置接口：

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| apiUrl | string | 是 | Backend API 地址 |
| projectId | string | 是 | 项目ID |
| token | string | 否 | JWT Token |
| theme | "light" \| "dark" | 否 | 主题 |
| position | "bottom-right" \| "bottom-left" | 否 | 气泡位置 |
| title | string | 否 | 面板标题 |
| placeholder | string | 否 | 输入框占位文本 |

### ChatMessage

聊天消息接口：

| 属性 | 类型 | 说明 |
|------|------|------|
| id | string | 消息唯一ID |
| role | "user" \| "assistant" | 角色 |
| content | string | 消息内容 |
| timestamp | number | 时间戳 |
| metadata | object | 元数据（intent, citations, hallucinationPassed） |

### Citation

引用来源接口：

| 属性 | 类型 | 说明 |
|------|------|------|
| type | "document" \| "graph" | 引用类型 |
| source | string | 来源标识 |
| score | number | 相关度分数（仅 document 类型） |

### ChatResponse

对话响应接口：

| 属性 | 类型 | 说明 |
|------|------|------|
| answer | string | 生成的答案 |
| intent | string | 识别的意图 |
| intent_confidence | number | 意图置信度 |
| retrieval_strategy | string | 检索策略 |
| citations | Citation[] | 引用列表 |
| hallucination_score | number | 幻觉分数 |
| hallucination_passed | boolean | 幻觉检查是否通过 |
| metadata | object | 元数据 |

---

## 导出入口

**文件：** `src/index.tsx`

```typescript
export { ChatWidget } from "./ChatWidget";
export type { BGAWidgetConfig, ChatMessage, Citation, ChatResponse } from "./types";
```

外部项目导入方式：

```typescript
import { ChatWidget, BGAWidgetConfig } from "business-guide-agent-frontend";
```

---

## 主页面

**文件：** `index.html`

Vite 入口 HTML，包含：

- ChatWidget 挂载点
- 项目切换说明（通过 URL 参数 `?projectId=xxx`）
- 管理后台入口链接（`/admin.html`）
- 环境变量配置（`VITE_API_URL`、`VITE_PROJECT_ID`）

### 配置注入

```javascript
const config = {
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3000",
  projectId: new URLSearchParams(window.location.search).get("projectId")
    || import.meta.env.VITE_PROJECT_ID
    || "966ce4f1-b36a-4e9c-813c-343cca323caa",
};
```

优先级：URL 参数 > 环境变量 > 默认值