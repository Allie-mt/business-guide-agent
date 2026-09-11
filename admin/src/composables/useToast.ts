import { ref } from "vue";

const toasts = ref<{ id: number; msg: string; type: "success" | "error" }[]>(
  [],
);
let nextId = 0;

export function useToast() {
  function show(msg: string, type: "success" | "error" = "success") {
    const id = nextId++;
    toasts.value.push({ id, msg, type });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 3000);
  }

  return { toasts, show };
}
