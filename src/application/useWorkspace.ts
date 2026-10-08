import { useEffect, useState, useSyncExternalStore } from "react";
import { LocalWorkspaceRepository } from "../persistence/localRepository";
import { WorkspaceController } from "./workspaceController";
import type { State } from "../data";
export function useWorkspace() {
  const [controller] = useState(
    () => new WorkspaceController(new LocalWorkspaceRepository()),
  );
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    const unsubscribe = controller.connect();
    void controller.load();
    return unsubscribe;
  }, [controller]);
  useEffect(() => {
    if (!view.undo) return;
    const timer = setTimeout(
      controller.dismissUndo,
      Math.max(0, view.undo.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [controller, view.undo]);
  return {
    ...view,
    repository: controller.repository,
    setNotice: controller.setNotice,
    dismissUndo: controller.dismissUndo,
    update: (next: State, reason?: string, recovery = false) =>
      controller.save(next, reason, recovery, view.revision),
    remove: (next: State, label: string) =>
      controller.remove(next, label, view.revision),
    undoLast: () => controller.undoLast(view.revision),
    reload: () => controller.load(),
    clear: (confirmation: string) =>
      controller.clear(confirmation, view.revision),
  };
}
