import axios from "axios";

const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (res) => res.data.data,
  (err) => {
    const msg = err.response?.data?.message || err.message;
    return Promise.reject(new Error(msg));
  },
);

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  projectId: string;
  originalName: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  ingestStatus: "pending" | "processing" | "completed" | "failed";
  chunkCount?: number;
  createdAt: string;
}

export const projectApi = {
  list: () => api.get<any, Project[]>("/projects"),
  create: (name: string, description?: string) =>
    api.post("/projects", { name, description }),
  delete: (id: string) => api.delete(`/projects/${id}`),
};

export const documentApi = {
  listByProject: (projectId: string) =>
    api.get<any, Document[]>(`/documents/project/${projectId}`),
  upload: (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectId", projectId);
    return axios.post("/api/v1/documents/upload", formData);
  },
  ingest: (docId: string) => api.post(`/documents/${docId}/ingest`),
  delete: (docId: string) => api.delete(`/documents/${docId}`),
};
