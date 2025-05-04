import type { World } from "./world";

const LOCAL_STORAGE_KEY = "worlds";

interface ProjectRecord {
  readonly name?: string;
  readonly created: number;
  readonly modified: number;
  readonly workspace: World;
}

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
    saveProject(id: string, world: World) {
      const now = Date.now();
      const existing = parsed[id];
      if (existing) {
        parsed[id] = { ...existing, workspace: world, modified: now };
      } else {
        parsed[id] = { created: now, modified: now, workspace: world };
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    },
    getProject(uuid: string) {
      return parsed[uuid];
    },
    deleteProject(id: string) {
      delete parsed[id];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    },
    renameProject(id: string, name: string) {
      const existing = parsed[id];
      if (!existing) return;
      parsed[id] = { ...existing, name };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    },
  };
}
