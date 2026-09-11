<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { projectApi, documentApi, type Document, type Project } from "../api";
import { useToast } from "../composables/useToast";

const route = useRoute();
const router = useRouter();
const { show } = useToast();

const projectId = computed(() => route.params.id as string);
const project = ref<Project | null>(null);
const docs = ref<Document[]>([]);
const loading = ref(true);
const uploading = ref(false);
const isDragOver = ref(false);

async function loadProject() {
  try {
    const projects = await projectApi.list();
    project.value = projects.find((p) => p.id === projectId.value) || null;
  } catch {}
}

async function loadDocs() {
  try {
    loading.value = true;
    docs.value = await documentApi.listByProject(projectId.value);
  } catch (e) {
    show("加载文档失败: " + (e as Error).message, "error");
  } finally {
    loading.value = false;
  }
}

async function handleFileUpload(files: FileList | File[]) {
  if (!files.length) return;
  uploading.value = true;
  let successCount = 0;
  for (const file of files) {
    try {
      await documentApi.upload(projectId.value, file);
      successCount++;
    } catch (e) {
      show(`${file.name} 上传失败`, "error");
    }
  }
  if (successCount > 0) {
    show(`${successCount} 个文件上传成功`);
    loadDocs();
  }
  uploading.value = false;
}

function onFileInput(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files?.length) handleFileUpload(target.files);
  target.value = "";
}

function onDrop(e: DragEvent) {
  isDragOver.value = false;
  e.preventDefault();
  if (e.dataTransfer?.files.length) handleFileUpload(e.dataTransfer.files);
}

async function ingestDoc(docId: string) {
  try {
    await documentApi.ingest(docId);
    show("摄取已触发");
    setTimeout(loadDocs, 2000);
  } catch (e) {
    show("摄取失败: " + (e as Error).message, "error");
  }
}

async function ingestAll() {
  const pending = docs.value.filter((d) => d.ingestStatus !== "completed");
  if (!pending.length) {
    show("所有文档已摄取完成");
    return;
  }
  try {
    for (const d of pending) {
      await documentApi.ingest(d.id);
    }
    show(`已触发 ${pending.length} 个文档的摄取`);
    setTimeout(loadDocs, 3000);
  } catch (e) {
    show("批量摄取失败: " + (e as Error).message, "error");
  }
}

async function deleteDoc(docId: string) {
  if (!confirm("确定删除该文档？")) return;
  try {
    await documentApi.delete(docId);
    show("文档已删除");
    loadDocs();
  } catch (e) {
    show("删除失败: " + (e as Error).message, "error");
  }
}

function statusText(status: string) {
  const map: Record<string, string> = {
    completed: "已摄取",
    processing: "处理中",
    failed: "失败",
    pending: "待摄取",
  };
  return map[status] || status;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

onMounted(() => {
  loadProject();
  loadDocs();
});
</script>

<template>
  <div class="project-detail">
    <div class="page-header">
      <button class="back-btn" @click="router.push('/')">
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
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        返回
      </button>
      <div class="page-info">
        <h1 class="page-title">{{ project?.name || "项目详情" }}</h1>
        <span class="page-id">{{ projectId }}</span>
      </div>
      <a
        :href="'http://localhost:5173/?projectId=' + projectId"
        target="_blank"
        class="chat-link"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          />
        </svg>
        打开对话
      </a>
    </div>

    <div class="card">
      <h2 class="card-title">
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
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        文档管理
      </h2>

      <div
        class="upload-area"
        :class="{ dragover: isDragOver, uploading }"
        @click="($refs.fileInput as HTMLInputElement)?.click()"
        @dragover.prevent="isDragOver = true"
        @dragleave="isDragOver = false"
        @drop="onDrop"
      >
        <template v-if="uploading">
          <div class="spinner"></div>
          <div>上传中...</div>
        </template>
        <template v-else>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="upload-icon"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div class="upload-text">点击或拖拽文件到此处上传</div>
          <div class="upload-hint">支持 PDF、TXT、MD 格式</div>
        </template>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".pdf,.txt,.md"
        multiple
        style="display: none"
        @change="onFileInput"
      />

      <div v-if="loading" class="loading-row">
        <div class="spinner-sm"></div>
        加载中...
      </div>

      <div v-else-if="docs.length === 0" class="empty-docs">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          class="empty-icon"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <div>暂无文档，上传文件后可自动向量化</div>
      </div>

      <table v-else class="doc-table">
        <thead>
          <tr>
            <th>文件名</th>
            <th>大小</th>
            <th>状态</th>
            <th>分块数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in docs" :key="d.id">
            <td class="doc-name">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
              >
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {{ d.originalName }}
            </td>
            <td>{{ formatSize(d.fileSize) }}</td>
            <td>
              <span class="status" :class="'status-' + d.ingestStatus">
                {{ statusText(d.ingestStatus) }}
              </span>
            </td>
            <td>{{ d.chunkCount || 0 }}</td>
            <td class="doc-actions">
              <button
                v-if="d.ingestStatus !== 'completed'"
                class="btn btn-sm btn-primary"
                @click="ingestDoc(d.id)"
              >
                {{ d.ingestStatus === "processing" ? "重新摄取" : "摄取" }}
              </button>
              <button class="btn btn-sm btn-danger" @click="deleteDoc(d.id)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="card-footer">
        <button class="btn btn-outline" @click="loadDocs">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          刷新
        </button>
        <button class="btn btn-primary" @click="ingestAll">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          全部摄取
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-detail {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}
.back-btn:hover {
  border-color: #6366f1;
  color: #6366f1;
}

.page-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.page-title {
  font-size: 22px;
  font-weight: 700;
  color: #1e293b;
}
.page-id {
  font-size: 11px;
  color: #94a3b8;
  font-family: monospace;
}

.chat-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #6366f1;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}
.chat-link:hover {
  border-color: #6366f1;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
}

.card {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 24px;
}
.card-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1e293b;
}

.upload-area {
  border: 2px dashed #cbd5e1;
  border-radius: 12px;
  padding: 36px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.upload-area:hover {
  border-color: #6366f1;
  background: #f5f3ff;
}
.upload-area.dragover {
  border-color: #6366f1;
  background: #ede9fe;
}
.upload-area.uploading {
  pointer-events: none;
  opacity: 0.6;
}
.upload-icon {
  color: #94a3b8;
}
.upload-text {
  font-size: 15px;
  color: #475569;
}
.upload-hint {
  font-size: 13px;
  color: #94a3b8;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e2e8f0;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid #e2e8f0;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  vertical-align: middle;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-row {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.empty-docs {
  text-align: center;
  padding: 32px;
  color: #94a3b8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.empty-icon {
  opacity: 0.4;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
}
.doc-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 2px solid #f1f5f9;
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.doc-table td {
  padding: 12px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 14px;
}
.doc-table tr:hover td {
  background: #f8fafc;
}
.doc-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.status {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}
.status-completed {
  background: #dcfce7;
  color: #166534;
}
.status-processing {
  background: #fef9c3;
  color: #854d0e;
}
.status-failed {
  background: #fee2e2;
  color: #991b1b;
}
.status-pending {
  background: #f1f5f9;
  color: #64748b;
}

.doc-actions {
  display: flex;
  gap: 6px;
}

.btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.btn-primary {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
}
.btn-primary:hover {
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
}
.btn-outline {
  background: #fff;
  border: 1px solid #e2e8f0;
  color: #475569;
}
.btn-outline:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}
.btn-danger {
  background: #fee2e2;
  color: #dc2626;
}
.btn-danger:hover {
  background: #fecaca;
}

.card-footer {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  gap: 8px;
}
</style>
