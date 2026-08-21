import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

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

  it(`should use defineConfig from vitest/config`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import defineConfig from vitest/config
    expect(configContent).toMatch(
      /import \{ defineConfig[^}]*\} from ["']vitest\/config["']/,
    )
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

  it(`should export default defineConfig`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should export default with defineConfig
    expect(configContent).toMatch(/export default\s+(defineConfig|mergeConfig)\(/)
  })

  it(`should configure coverage to include only src directory`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Coverage should be scoped to src only
    expect(configContent).toContain(`include: [\`src/**/*\`]`)
    expect(configContent).not.toContain(`include: [\`**/*\``)
  })
})
