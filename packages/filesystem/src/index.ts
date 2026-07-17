import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"

export interface FileSystem {
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  listDirectories(path: string): Promise<string[]>
  removePath(path: string): Promise<void>
}

export const nodeFileSystem: FileSystem = {
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false
      throw error
    }
  },
  readText: (path) => readFile(path, "utf8"),
  async writeText(path, content) {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = path + ".tmp-" + randomUUID()
    await writeFile(temporaryPath, content, "utf8")
    await rename(temporaryPath, path)
  },
  removePath: (path) => rm(path, { recursive: true, force: true }),
  async listDirectories(path) {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  },
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}
