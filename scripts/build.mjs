import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'
import { fork, execSync } from 'child_process'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

const dev = process.argv.includes('--dev')
const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')
const buildDir = path.join(rootDir, 'build')
const modsDir = path.join(rootDir, 'mods')

// await fs.emptyDir(buildDir)
await fs.emptyDir(path.join(buildDir, 'public'))

// Get all mod directories
async function getModDirectories() {
  try {
    const entries = await fs.readdir(modsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch (err) {
    console.error('Error reading mods directory:', err)
    return []
  }
}

// Generate packets module first, as it's needed by both client and server
await generatePacketsModule()

/**
 * Generate a consolidated packets module
 * This ensures consistent packet IDs between client and server
 */
async function generatePacketsModule() {
  const packetsOutputDir = path.join(rootDir, 'src/core/.gen')
  const packetsOutputFile = path.join(packetsOutputDir, 'generated-packets.js')
  
  try {
    // Ensure output directory exists
    await fs.ensureDir(packetsOutputDir)
    
    let allPacketNames = []
    const modDirectories = await getModDirectories()
    
    // Process packets from each mod directory
    for (const modName of modDirectories) {
      const packetsDir = path.join(modsDir, modName, 'core/packets')
      
      // Check if this mod has a packets directory
      if (await fs.pathExists(packetsDir)) {
        const entries = await fs.readdir(packetsDir, { withFileTypes: true })
        
        // Filter for JS files
        const packetFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.mjs'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Collect all packet names from each file
        for (const file of packetFiles) {
          const filePath = path.join(packetsDir, file.name)
          const fileUrl = `file://${filePath}`
          
          try {
            // Import the packet definition file
            const module = await import(fileUrl)
            const packetNames = module.default
            
            if (Array.isArray(packetNames)) {
              // Add each packet name to the collection
              for (const name of packetNames) {
                if (!allPacketNames.includes(name)) {
                  allPacketNames.push(name)
                }
              }
            }
          } catch (err) {
            console.error(`Error processing packet definition file ${modName}/${file.name}:`, err)
          }
        }
      }
    }
    
    console.log(`Found ${allPacketNames.length} custom packet definitions across all mods`)
    
    // Create the module content
    const moduleContent = `// GENERATED FILE - DO NOT EDIT
// This file is auto-generated during the build process.
// Custom packet definitions are collected from mods/*/core/packets/*.js

// Original built-in packet names
export const builtInPackets = [
  'snapshot',
  'command',
  'chatAdded',
  'chatCleared',
  'blueprintAdded',
  'blueprintModified',
  'entityAdded',
  'entityModified',
  'entityEvent',
  'entityRemoved',
  'playerTeleport',
  'playerPush',
  'playerSessionAvatar',
  'settingsModified',
  'spawnModified',
  'kick',
  'ping',
  'pong',
]

// Custom packet names collected from mods
export const customPackets = [
  ${allPacketNames.map(name => `'${name}'`).join(',\n  ')}
]

// Combined packet names (built-in + custom)
export const allPackets = [
  ...builtInPackets,
  ...customPackets
]
`
    
    // Write the module file
    await fs.writeFile(packetsOutputFile, moduleContent)
    console.log(`Generated packets module with ${allPacketNames.length} custom packets`)
    
    return allPacketNames.length
  } catch (err) {
    console.error('Error generating packets module:', err)
    return 0
  }
}

/**
 * Generate a module that collects and exports all mod components
 * This allows component mods to be bundled with the client
 */
async function generateModComponentsModule() {
  const modComponentsOutputDir = path.join(rootDir, 'mods/.gen')
  const modComponentsOutputFile = path.join(modComponentsOutputDir, 'ModComponents.js')
  
  try {
    // Ensure output directory exists
    await fs.ensureDir(modComponentsOutputDir)
    
    let imports = []
    let exports = []
    const modDirectories = await getModDirectories()
    
    // Process components from each mod directory
    for (const modName of modDirectories) {
      const modComponentsDir = path.join(modsDir, modName, 'client')
      
      // Check if this mod has a client directory with components
      if (await fs.pathExists(modComponentsDir)) {
        const entries = await fs.readdir(modComponentsDir, { withFileTypes: true })
        
        // Filter for JS/JSX/TSX files
        const componentFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.jsx', '.tsx'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Generate imports and exports with mod name prefixes to avoid collisions
        componentFiles.forEach((file) => {
          const componentName = path.parse(file.name).name
          const uniqueComponentName = `${modName}_${componentName}`
          const relativePath = path.relative(
            modComponentsOutputDir,
            path.join(modComponentsDir, file.name)
          ).replace(/\\/g, '/')
          
          imports.push(`import ${uniqueComponentName} from '${relativePath}'`)
          exports.push(`  ${componentName}: ${uniqueComponentName}`)
        })
      }
    }
    
    // Create the module content
    const moduleContent = `${imports.join('\n')}

export const ModComponents = {
${exports.join(',\n')}
}
`
    // Write the module file
    await fs.writeFile(modComponentsOutputFile, moduleContent)
    console.log(`Generated mod components module with ${exports.length} components`)
  } catch (err) {
    console.error('Error generating mod components module:', err)
    // Create fallback empty module
    const moduleContent = `export const ModComponents = {}`
    await fs.writeFile(modComponentsOutputFile, moduleContent)
  }
}

/**
 * Generate a module that collects mod sidebar buttons and panes
 */
async function generateModSidebarModule() {
  const modComponentsOutputDir = path.join(rootDir, 'mods/.gen')
  const modSidebarOutputFile = path.join(modComponentsOutputDir, 'ModSidebar.js')
  
  try {
    // Ensure output directory exists
    await fs.ensureDir(modComponentsOutputDir)
    
    let imports = []
    let buttonExports = []
    let paneExports = []
    const modDirectories = await getModDirectories()
    
    // Process sidebar components from each mod directory
    for (const modName of modDirectories) {
      const modSidebarDir = path.join(modsDir, modName, 'client/sidebar')
      
      // Check if this mod has a sidebar directory
      if (await fs.pathExists(modSidebarDir)) {
        const entries = await fs.readdir(modSidebarDir, { withFileTypes: true })
        
        // Filter for JS/JSX/TSX files
        const sidebarFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.jsx', '.tsx'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Generate imports and exports with mod name to avoid collisions
        sidebarFiles.forEach((file) => {
          const moduleName = path.parse(file.name).name
          const uniqueModuleName = `${modName}_${moduleName}`
          const relativePath = path.relative(
            modComponentsOutputDir,
            path.join(modSidebarDir, file.name)
          ).replace(/\\/g, '/')
          
          imports.push(`import { ${moduleName}Button as ${uniqueModuleName}Button, ${moduleName}Pane as ${uniqueModuleName}Pane } from '${relativePath}'`)
          buttonExports.push(`  ${moduleName}: ${uniqueModuleName}Button`)
          paneExports.push(`  ${moduleName}: ${uniqueModuleName}Pane`)
        })
      }
    }
    
    // Create the module content
    const moduleContent = `${imports.join('\n')}

export const ModSidebarButtons = {
${buttonExports.join(',\n')}
}

export const ModSidebarPanes = {
${paneExports.join(',\n')}
}
`
    // Write the module file
    await fs.writeFile(modSidebarOutputFile, moduleContent)
    console.log(`Generated mod sidebar module with ${buttonExports.length} sidebar components`)
  } catch (err) {
    console.error('Error generating mod sidebar module:', err)
    // Create fallback empty module
    const moduleContent = `// This file will be auto-generated during build
export const ModSidebarButtons = {}
export const ModSidebarPanes = {}`
    await fs.writeFile(modSidebarOutputFile, moduleContent)
  }
}

/**
 * Generate client mods manifest
 * Scans all mod directories for client mods and bundles them,
 * then creates a manifest file with the bundled mod paths
 */
async function generateClientModsManifest() {
  const clientModsBuildDir = path.join(rootDir, 'build/public/mods/client')
  const sharedClientModsBuildDir = path.join(rootDir, 'build/public/mods/shared')
  const manifestPath = path.join(rootDir, 'build/public/mods-manifest.json')
  const manifest = { mods: [] }

  try {
    // Ensure build directories exist
    await fs.ensureDir(clientModsBuildDir)
    await fs.ensureDir(sharedClientModsBuildDir)
    
    const modDirectories = await getModDirectories()
    
    // Process each mod directory
    for (const modName of modDirectories) {
      // Process client-specific mods
      const clientModsDir = path.join(modsDir, modName, 'core/client')
      if (await fs.pathExists(clientModsDir)) {
        const entries = await fs.readdir(clientModsDir, { withFileTypes: true })
        
        // Filter for JS/TS files
        const modFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Build each mod file
        for (const entry of modFiles) {
          const srcPath = path.join(clientModsDir, entry.name)
          const fileName = path.parse(entry.name).name
          const outputSubdir = path.join(clientModsBuildDir, modName)
          
          try {
            // Ensure output subdirectory exists
            await fs.ensureDir(outputSubdir)
            
            // Bundle the mod with esbuild
            const result = await esbuild.build({
              entryPoints: [srcPath],
              outdir: outputSubdir,
              entryNames: '[name]-[hash]',
              platform: 'browser',
              format: 'esm',
              bundle: true,
              minify: !dev,
              sourcemap: true,
              metafile: true,
              jsx: 'automatic',
              jsxImportSource: '@firebolt-dev/jsx',
              define: {
                'process.env.NODE_ENV': dev ? '"development"' : '"production"',
                'process.env.CLIENT': 'true',
                'process.env.SERVER': 'false',
              },
              loader: {
                '.js': 'jsx',
              },
              plugins: [
                polyfillNode({}),
              ]
            })
            
            // Find the output file from metafile
            const outputs = Object.keys(result.metafile.outputs)
            const bundledFilePath = outputs.find(file => file.includes(fileName) && file.endsWith('.js'))
            
            if (bundledFilePath) {
              // Get the path relative to the build/public directory
              const relativePath = bundledFilePath.split('build/public')[1]
              manifest.mods.push(relativePath)
              console.log(`Bundled client mod: ${modName}/${entry.name} -> ${relativePath}`)
            }
          } catch (err) {
            console.error(`Error bundling client mod ${modName}/${entry.name}:`, err)
          }
        }
      }

      // Process shared mods for client
      const sharedModsDir = path.join(modsDir, modName, 'core/shared')
      if (await fs.pathExists(sharedModsDir)) {
        const entries = await fs.readdir(sharedModsDir, { withFileTypes: true })
        
        // Filter for JS/TS files
        const modFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Build each shared mod for client
        for (const entry of modFiles) {
          const srcPath = path.join(sharedModsDir, entry.name)
          const fileName = path.parse(entry.name).name
          const outputSubdir = path.join(sharedClientModsBuildDir, modName)
          
          try {
            // Ensure output subdirectory exists
            await fs.ensureDir(outputSubdir)
            
            // Bundle the mod with esbuild for client
            const result = await esbuild.build({
              entryPoints: [srcPath],
              outdir: outputSubdir,
              entryNames: '[name]-[hash]',
              platform: 'browser',
              format: 'esm',
              bundle: true,
              minify: !dev,
              sourcemap: true,
              metafile: true,
              jsx: 'automatic',
              jsxImportSource: '@firebolt-dev/jsx',
              define: {
                'process.env.NODE_ENV': dev ? '"development"' : '"production"',
                'process.env.CLIENT': 'true',
                'process.env.SERVER': 'false',
                'process.env.SHARED': 'true',
              },
              loader: {
                '.js': 'jsx',
              },
              plugins: [
                polyfillNode({}),
              ]
            })
            
            // Find the output file from metafile
            const outputs = Object.keys(result.metafile.outputs)
            const bundledFilePath = outputs.find(file => file.includes(fileName) && file.endsWith('.js'))
            
            if (bundledFilePath) {
              // Get the path relative to the build/public directory
              const relativePath = bundledFilePath.split('build/public')[1]
              manifest.mods.push(relativePath)
              console.log(`Bundled shared mod for client: ${modName}/${entry.name} -> ${relativePath}`)
            }
          } catch (err) {
            console.error(`Error bundling shared mod for client ${modName}/${entry.name}:`, err)
          }
        }
      }
    }

    // Write the manifest file
    await fs.ensureDir(path.dirname(manifestPath))
    await fs.writeJson(manifestPath, manifest, { spaces: 2 })
    console.log(`Generated client mods manifest with ${manifest.mods.length} mods`)
  } catch (err) {
    console.error('Error generating client mods manifest:', err)
  }
}

/**
 * Generate server mods manifest
 * Scans all mod directories for server mods and bundles them,
 * then creates a manifest file with the bundled mod paths
 */
async function generateServerModsManifest() {
  const serverModsBuildDir = path.join(rootDir, 'build/mods/server')
  const sharedServerModsBuildDir = path.join(rootDir, 'build/mods/shared')
  const manifestPath = path.join(rootDir, 'build/server-mods-manifest.json')
  const manifest = { mods: [] }

  try {
    // Ensure build directories exist
    await fs.ensureDir(serverModsBuildDir)
    await fs.ensureDir(sharedServerModsBuildDir)
    
    const modDirectories = await getModDirectories()
    
    // Process each mod directory
    for (const modName of modDirectories) {
      // Process server-specific mods
      const serverModsDir = path.join(modsDir, modName, 'core/server')
      if (await fs.pathExists(serverModsDir)) {
        const entries = await fs.readdir(serverModsDir, { withFileTypes: true })
        
        // Filter for JS/TS files
        const modFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.mjs', '.cjs', '.ts'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Build each mod file
        for (const entry of modFiles) {
          const srcPath = path.join(serverModsDir, entry.name)
          const fileName = path.parse(entry.name).name
          const outputSubdir = path.join(serverModsBuildDir, modName)
          
          try {
            // Ensure output subdirectory exists
            await fs.ensureDir(outputSubdir)
            
            // Bundle the mod with esbuild
            const result = await esbuild.build({
              entryPoints: [srcPath],
              outdir: outputSubdir,
              entryNames: '[name]-[hash]',
              platform: 'node',
              format: 'esm',
              bundle: true,
              minify: false,
              sourcemap: true,
              metafile: true,
              packages: 'external',
              define: {
                'process.env.NODE_ENV': dev ? '"development"' : '"production"',
                'process.env.CLIENT': 'false',
                'process.env.SERVER': 'true',
              },
              plugins: []
            })
            
            // Find the output file from metafile
            const outputs = Object.keys(result.metafile.outputs)
            const bundledFilePath = outputs.find(file => file.includes(fileName) && file.endsWith('.js'))
            
            if (bundledFilePath) {
              // Use file:// URL for Node.js imports
              const absolutePath = path.join(process.cwd(), bundledFilePath)
              const fileUrl = `file://${absolutePath}`
              manifest.mods.push(fileUrl)
              console.log(`Bundled server mod: ${modName}/${entry.name} -> ${fileUrl}`)
            }
          } catch (err) {
            console.error(`Error bundling server mod ${modName}/${entry.name}:`, err)
          }
        }
      }

      // Process shared mods for server
      const sharedModsDir = path.join(modsDir, modName, 'core/shared')
      if (await fs.pathExists(sharedModsDir)) {
        const entries = await fs.readdir(sharedModsDir, { withFileTypes: true })
        
        // Filter for JS/TS files
        const modFiles = entries
          .filter(entry => 
            entry.isFile() && 
            ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'].includes(
              path.extname(entry.name).toLowerCase()
            )
          );
        
        // Build each shared mod for server
        for (const entry of modFiles) {
          const srcPath = path.join(sharedModsDir, entry.name)
          const fileName = path.parse(entry.name).name
          const outputSubdir = path.join(sharedServerModsBuildDir, modName)
          
          try {
            // Ensure output subdirectory exists
            await fs.ensureDir(outputSubdir)
            
            // Bundle the mod with esbuild for server
            const result = await esbuild.build({
              entryPoints: [srcPath],
              outdir: outputSubdir,
              entryNames: '[name]-[hash]',
              platform: 'node',
              format: 'esm',
              bundle: true,
              minify: false,
              sourcemap: true,
              metafile: true,
              packages: 'external',
              define: {
                'process.env.NODE_ENV': dev ? '"development"' : '"production"',
                'process.env.CLIENT': 'false',
                'process.env.SERVER': 'true',
                'process.env.SHARED': 'true',
              },
              plugins: []
            })
            
            // Find the output file from metafile
            const outputs = Object.keys(result.metafile.outputs)
            const bundledFilePath = outputs.find(file => file.includes(fileName) && file.endsWith('.js'))
            
            if (bundledFilePath) {
              // Use file:// URL for Node.js imports
              const absolutePath = path.join(process.cwd(), bundledFilePath)
              const fileUrl = `file://${absolutePath}`
              manifest.mods.push(fileUrl)
              console.log(`Bundled shared mod for server: ${modName}/${entry.name} -> ${fileUrl}`)
            }
          } catch (err) {
            console.error(`Error bundling shared mod for server ${modName}/${entry.name}:`, err)
          }
        }
      }
    }

    // Write the manifest file
    await fs.writeJson(manifestPath, manifest, { spaces: 2 })
    console.log(`Generated server mods manifest with ${manifest.mods.length} mods`)
  } catch (err) {
    console.error('Error generating server mods manifest:', err)
  }
}

/**
 * Build Client
 */

const clientPublicDir = path.join(rootDir, 'src/client/public')
const clientBuildDir = path.join(rootDir, 'build/public')
const clientHtmlSrc = path.join(rootDir, 'src/client/public/index.html')
const clientHtmlDest = path.join(rootDir, 'build/public/index.html')

await generateModComponentsModule()
await generateModSidebarModule()

{
  const clientCtx = await esbuild.context({
    entryPoints: ['src/client/index.js', 'src/client/particles.js'],
    entryNames: '/[name]-[hash]',
    outdir: clientBuildDir,
    platform: 'browser',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: !dev,
    sourcemap: true,
    metafile: true,
    jsx: 'automatic',
    jsxImportSource: '@firebolt-dev/jsx',
    define: {
      'process.env.NODE_ENV': dev ? '"development"' : '"production"',
    },
    loader: {
      '.js': 'jsx',
    },
    alias: {
      react: 'react', // always use our own local react (jsx)
    },
    plugins: [
      polyfillNode({}),
      {
        name: 'client-finalize-plugin',
        setup(build) {
          build.onEnd(async result => {
            // Generate client mods manifest
            await generateClientModsManifest()
            
            // copy over public files
            await fs.copy(clientPublicDir, clientBuildDir)
            // copy physx wasm to public
            const physxWasmSrc = path.join(rootDir, 'src/core/physx-js-webidl.wasm')
            const physxWasmDest = path.join(rootDir, 'build/public/physx-js-webidl.wasm')
            await fs.copy(physxWasmSrc, physxWasmDest)
            // find js output files
            const metafile = result.metafile
            const outputFiles = Object.keys(metafile.outputs)
            const jsPath = outputFiles
              .find(file => file.includes('/index-') && file.endsWith('.js'))
              .split('build/public')[1]
            const particlesPath = outputFiles
              .find(file => file.includes('/particles-') && file.endsWith('.js'))
              .split('build/public')[1]
            // inject into html and copy over
            let htmlContent = await fs.readFile(clientHtmlSrc, 'utf-8')
            htmlContent = htmlContent.replace('{jsPath}', jsPath)
            htmlContent = htmlContent.replace('{particlesPath}', particlesPath)
            htmlContent = htmlContent.replaceAll('{buildId}', Date.now())
            await fs.writeFile(clientHtmlDest, htmlContent)
          })
        },
      },
    ],
  })
  if (dev) {
    await clientCtx.watch()
  } else {
    await clientCtx.rebuild()
  }
  const buildResult = await clientCtx.rebuild()
  fs.writeFileSync(path.join(buildDir, 'meta.json'), JSON.stringify(buildResult.metafile, null, 2))
}

/**
 * Build Server
 */

let spawn

{
  const serverCtx = await esbuild.context({
    entryPoints: ['src/server/index.js'],
    outfile: 'build/index.js',
    platform: 'node',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: false,
    sourcemap: true,
    packages: 'external',
    define: {
      'process.env.CLIENT': 'false',
      'process.env.SERVER': 'true',
    },
    plugins: [
      {
        name: 'server-finalize-plugin',
        setup(build) {
          build.onEnd(async result => {
            // Generate server mods manifest
            await generateServerModsManifest()
            
            // copy over physx js
            const physxIdlSrc = path.join(rootDir, 'src/core/physx-js-webidl.js')
            const physxIdlDest = path.join(rootDir, 'build/physx-js-webidl.js')
            await fs.copy(physxIdlSrc, physxIdlDest)
            // copy over physx wasm
            const physxWasmSrc = path.join(rootDir, 'src/core/physx-js-webidl.wasm')
            const physxWasmDest = path.join(rootDir, 'build/physx-js-webidl.wasm')
            await fs.copy(physxWasmSrc, physxWasmDest)
            // start the server or stop here
            if (dev) {
              // (re)start server
              spawn?.kill('SIGTERM')
              spawn = fork(path.join(rootDir, 'build/index.js'))
            } else {
              process.exit(0)
            }
          })
        },
      },
    ],
    loader: {},
  })
  if (dev) {
    await serverCtx.watch()
  } else {
    await serverCtx.rebuild()
  }
}
