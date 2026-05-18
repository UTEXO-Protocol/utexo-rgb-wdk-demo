// Shims for the two RN-only modules `TestRunner.ts` imports:
//   - expo-file-system  (used to write the report JSON)
//   - react-native      (used to read Platform.OS)
//
// On Node we write the report through fs.writeFileSync into
// $WDK_DATA_DIR/reports/, and report a synthetic platform tag.
// Keeping the original API shape means TestRunner.ts ports unchanged.

import fs from 'node:fs'
import path from 'node:path'

const REPORTS_DIR = (() => {
  const root = process.env.WDK_DATA_DIR ?? path.resolve(process.cwd(), '.data')
  const dir = path.join(root, 'reports')
  fs.mkdirSync(dir, { recursive: true })
  return dir
})()

export const Paths = {
  // `expo-file-system/next` exposes `Paths.document` as the document
  // root. On Node we point that at our reports dir.
  document: REPORTS_DIR
}

export class File {
  private absPath: string
  constructor (root: string, name: string) {
    this.absPath = path.join(root, name)
  }
  get exists (): boolean { return fs.existsSync(this.absPath) }
  delete (): void { fs.rmSync(this.absPath, { force: true }) }
  create (): void { fs.writeFileSync(this.absPath, '') }
  write (data: string): void { fs.writeFileSync(this.absPath, data) }
}

// Mirror the `Platform.OS` field from react-native. On Node we report
// 'node' so platformTag() can be extended to recognise it.
export const Platform = {
  OS: 'node' as 'ios' | 'android' | 'web' | 'node' | 'macos' | 'windows'
}
