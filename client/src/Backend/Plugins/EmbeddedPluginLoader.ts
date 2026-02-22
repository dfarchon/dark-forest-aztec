import { PluginId } from "@dfpunk/types";

/**
 * This interface represents an embedded plugin, which is stored in `embedded_plugins/`.
 */
export interface EmbeddedPlugin {
  id: PluginId;
  name: string;
  code: string;
}

/**
 * Load all of the embedded plugins in the dist directory of the `embedded_plugins/` project
 * as Plain Text files. This means that `embedded_plugins/` can't use `import` for relative paths.
 * Uses Vite's import.meta.glob (no require.context in ESM).
 */
const pluginsModules = import.meta.glob<{ default: string }>(
  "../../../embedded_plugins/*.[jt]sx?",
  { query: "?raw", eager: true }
);

function cleanFilename(path: string): string {
  const basename = path.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "");
  return basename.replace(/[_-]/g, " ");
}

export function getEmbeddedPlugins(isAdmin: boolean): EmbeddedPlugin[] {
  return Object.entries(pluginsModules)
    .filter(([path]) => isAdmin || !path.includes("Admin-Controls"))
    .map(([path, mod]) => ({
      id: path as PluginId,
      name: cleanFilename(path),
      code: mod.default,
    }));
}
