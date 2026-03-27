import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

/**
 * Tests for vite.config.ts configuration
 * Validates that the Vite/Vitest configuration is properly structured
 */

describe(`Vite Configuration`, () => {
  const configPath = join(__dirname, `..`, `vite.config.ts`)

  it(`should export a valid vitest config`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import from vitest/config
    expect(configContent).toContain(`from "vitest/config"`)

    // Should use defineConfig
    expect(configContent).toContain(`defineConfig`)
  })

  it(`should merge with tanstack vite config`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import tanstack config
    expect(configContent).toContain(
      `from "@tanstack/config/vite"`
    )
    expect(configContent).toContain(`tanstackViteConfig`)

    // Should use mergeConfig
    expect(configContent).toContain(`mergeConfig`)
  })

  it(`should configure test directory`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should specify test directory
    expect(configContent).toContain(`dir:`)
    expect(configContent).toContain(`./tests`)
  })

  it(`should configure jsdom environment`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should use jsdom for tests requiring DOM APIs
    expect(configContent).toContain(`environment:`)
    expect(configContent).toContain(`jsdom`)
  })

  it(`should enable coverage with istanbul`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should configure coverage
    expect(configContent).toContain(`coverage:`)
    expect(configContent).toContain(`enabled: true`)
    expect(configContent).toContain(`provider: \`istanbul\``)
    expect(configContent).toContain(`include: [\`src/**/*\`]`)
  })

  it(`should enable typecheck`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should enable type checking in tests
    expect(configContent).toContain(`typecheck:`)
    expect(configContent).toContain(`enabled: true`)
  })

  it(`should use package name for test identification`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import and use package.json for name
    expect(configContent).toContain(`from "./package.json"`)
    expect(configContent).toContain(`name: packageJson.name`)
  })

  it(`should configure build entry point`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should specify entry point for tanstack config
    expect(configContent).toContain(`entry: \`./src/index.ts\``)
    expect(configContent).toContain(`srcDir: \`./src\``)
  })

  it(`should import defineConfig and mergeConfig from vitest/config`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import both utilities
    expect(configContent).toMatch(
      /import \{ defineConfig, mergeConfig \} from ["']vitest\/config["']/
    )
  })

  it(`should import package.json for dynamic name configuration`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import package.json
    expect(configContent).toMatch(
      /import packageJson from ["']\.\/package\.json["']/
    )
  })

  it(`should configure test name using package.json name`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Test name should reference packageJson.name
    expect(configContent).toMatch(/name:\s*packageJson\.name/)
  })

  it(`should export default merged configuration`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should export default with mergeConfig
    expect(configContent).toMatch(/export default\s+mergeConfig\(/)
  })

  it(`should pass valid options to tanstackViteConfig`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should configure tanstackViteConfig with entry and srcDir
    expect(configContent).toContain(`entry: \`./src/index.ts\``)
    expect(configContent).toContain(`srcDir: \`./src\``)
  })

  it(`should configure coverage to include only src directory`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Coverage should be scoped to src only
    expect(configContent).toContain(`include: [\`src/**/*\`]`)
    expect(configContent).not.toContain(`include: [\`**/*\``)
  })
})
