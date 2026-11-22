import { join } from 'node:path'

export interface ResourcePaths {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}

/** 随应用分发的资源：开发时在仓库 resources/，打包后在 process.resourcesPath。 */
export function resolveResource(name: string, paths: ResourcePaths): string {
  return paths.isPackaged ? join(paths.resourcesPath, name) : join(paths.appPath, 'resources', name)
}
