import type { Workspace } from "./workspace";

const LOCAL_STORAGE_KEY = "workspaces";

interface ProjectRecord {
  created: number;
  modified: number;
  workspace: Workspace;
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

export function createProjectStore() {
  const localstorage = localStorage.getItem(LOCAL_STORAGE_KEY);
  const raw = localstorage ? JSON.parse(localstorage) : null;
  // TODO use zod
  const parsed = raw ? (raw as Record<string, ProjectRecord>) : {};

  return {
    listProjects() {
      return Object.entries(parsed).sort(
        ([_key, value]) => value.created - value.created,
      );
    },
    saveProject(uuid: string, workspace: Workspace) {
      console.log("Saving workspace", uuid, workspace);
      const now = Date.now();
      const existing = parsed[uuid];
      if (existing) {
        parsed[uuid] = { ...existing, workspace, modified: now };
      } else {
        parsed[uuid] = { created: now, modified: now, workspace };
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    },
    getProject(uuid: string) {
      return parsed[uuid];
    },
    deleteProject(uuid: string) {
      delete parsed[uuid];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    },
  };
}
