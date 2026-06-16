import { useStore } from "../store";

export function Toast() {
  const { toast } = useStore();
  const cls = "toast" + (toast ? " active" : "") + (toast?.type === "error" ? " toast-error" : "");
  return (
    <div className={cls} role="status" aria-live="polite">
      {toast?.msg ?? ""}
    </div>
  );
}
