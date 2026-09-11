// Monorepo + alias : le cœur crypto importe libsodium-wrappers-sumo ; sur le
// device c'est react-native-libsodium (même surface) qui répond.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')]
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'libsodium-wrappers-sumo') return context.resolveRequest(context, 'react-native-libsodium', platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
