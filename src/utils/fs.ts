import { chmod, mkdir, open, stat } from 'node:fs/promises'

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

export async function ensurePrivateFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function chmodPrivate(path: string): Promise<void> {
  try {
    await chmod(path, 0o600)
  } catch {
    // Windows and some filesystems do not expose POSIX modes; best effort.
  }
}

export async function fileSize(path: string): Promise<number> {
  const info = await stat(path)
  return info.size
}
