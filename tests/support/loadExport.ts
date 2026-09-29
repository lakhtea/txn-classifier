/**
 * Loads a named export from a module under `src/` at run time rather than via a static import,
 * so a suite still collects (and each test fails individually) while the export does not exist yet.
 */
export const loadExport = async <T>(modulePath: string, exportName: string): Promise<T> => {
  const moduleUrl = new URL(`../../${modulePath}`, import.meta.url).href;

  let module: Record<string, unknown>;
  try {
    module = await import(/* @vite-ignore */ moduleUrl);
  } catch (error) {
    throw new Error(`Could not load ${modulePath}: implement and export ${exportName}`, {
      cause: error,
    });
  }

  if (typeof module[exportName] !== "function") {
    throw new Error(`${modulePath} must export a ${exportName} function`);
  }

  return module[exportName] as T;
};
