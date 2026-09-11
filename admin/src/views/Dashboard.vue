<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { projectApi, type Project } from "../api";
import { useToast } from "../composables/useToast";

const router = useRouter();
const { show } = useToast();

const projects = ref<Project[]>([]);
const loading = ref(true);
const newName = ref("");

async function loadProjects() {
  try {
    loading.value = true;
    projects.value = await projectApi.list();
  } catch (e) {
    show("加载项目失败: " + (e as Error).message, "error");
  } finally {
    loading.value = false;
  }
}

async function createProject() {
  const name = newName.value.trim();
  if (!name) {
    show("请输入项目名称", "error");
    return;
  }
  try {
    await projectApi.create(name);
    newName.value = "";
    show("项目创建成功");
    loadProjects();
  } catch (e) {
    show("创建失败: " + (e as Error).message, "error");
  }
}

async function deleteProject(id: string) {
  if (!confirm("确定删除该项目？关联的文档和对话数据将一并删除。")) return;
  try {
    await projectApi.delete(id);
    show("项目已删除");
    loadProjects();
  } catch (e) {
    show("删除失败: " + (e as Error).message, "error");
  }
}

function openProject(id: string) {
  router.push({ name: "ProjectDetail", params: { id } });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

onMounted(loadProjects);
</script>

<template>
  <div class="dashboard">
    <div class="page-header">
      <h1 class="page-title">项目管理</h1>
      <div class="create-bar">
        <input
          v-model="newName"
          class="create-input"
          placeholder="输入项目名称"
          @keydown.enter="createProject"
        />
        <button class="btn btn-primary" @click="createProject">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建项目
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else-if="projects.length === 0" class="empty-state">
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="empty-icon"
      >
        <path
          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        />
      </svg>
      <div class="empty-title">暂无项目</div>
      <div class="empty-desc">点击上方按钮创建第一个项目</div>
    </div>

    <div v-else class="project-grid">
      <div
        v-for="p in projects"
        :key="p.id"
        class="project-card"
        @click="openProject(p.id)"
      >
        <div class="card-header">
          <div class="card-icon">
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
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              />
            </svg>
          </div>
          <button
            class="card-delete"
            @click.stop="deleteProject(p.id)"
            title="删除项目"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              />
            </svg>
          </button>
        </div>
        <div class="card-name">{{ p.name || "未命名项目" }}</div>
        <div class="card-id">{{ p.id }}</div>
        <div class="card-meta">
          <span>创建于 {{ formatDate(p.createdAt) }}</span>
        </div>
        <div class="card-footer">
          <span class="card-action"> 管理文档 → </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}
.page-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
}

.create-bar {
  display: flex;
  gap: 8px;
}
.create-input {
  padding: 8px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  outline: none;
  width: 220px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  background: #fff;
}
.create-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.btn {
  padding: 8px 16px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.btn-primary {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.25);
}
.btn-primary:hover {
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px;
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
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-state {
  text-align: center;
  padding: 64px 24px;
  color: #94a3b8;
}
.empty-icon {
  margin-bottom: 16px;
  opacity: 0.5;
}
.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
}
.empty-desc {
  font-size: 14px;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.project-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.project-card:hover {
  border-color: #6366f1;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.12);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #e0e7ff, #c7d2fe);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4f46e5;
}
.card-delete {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    color 0.15s;
}
.card-delete:hover {
  background: #fee2e2;
  color: #ef4444;
}

.card-name {
  font-weight: 600;
  font-size: 16px;
  color: #1e293b;
}
.card-id {
  font-size: 11px;
  color: #94a3b8;
  word-break: break-all;
  font-family: monospace;
}
.card-meta {
  font-size: 12px;
  color: #64748b;
}

.card-footer {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}
.card-action {
  font-size: 13px;
  color: #6366f1;
  font-weight: 500;
}
</style>
