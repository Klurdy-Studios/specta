import type { FileSystem } from "@specta/core/filesystem"

/** Restores every declared path when a multi-artifact workflow commit fails. */
export async function runAtomically(
  fileSystem: FileSystem,
  paths: string[],
  operation: () => Promise<void>,
): Promise<void> {
  const backups = await Promise.all([...new Set(paths)].map(async (path) => {
    const existed = await fileSystem.exists(path)
    return { path, existed, content: existed ? await fileSystem.readText(path) : undefined }
  }))
  try {
    await operation()
  } catch (error) {
    await Promise.all(backups.map(async (backup) => {
      if (backup.existed && backup.content !== undefined) await fileSystem.writeText(backup.path, backup.content)
      else await fileSystem.removePath(backup.path)
    }))
    throw error
  }
}
