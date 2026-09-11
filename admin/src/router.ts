import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "Dashboard",
      component: () => import("./views/Dashboard.vue"),
    },
    {
      path: "/project/:id",
      name: "ProjectDetail",
      component: () => import("./views/ProjectDetail.vue"),
    },
  ],
});

export default router;
