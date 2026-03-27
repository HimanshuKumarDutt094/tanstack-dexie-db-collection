import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

/**
 * Tests for eslint.config.mjs configuration
 * Validates that the ESLint configuration file is properly structured
 * and contains expected rules and plugins.
 */

describe(`ESLint Configuration`, () => {
  const configPath = join(__dirname, `..`, `eslint.config.mjs`)

  it(`should export a valid configuration array`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should export default array
    expect(configContent).toContain(`export default [`)

    // Should spread tanstackConfig
    expect(configContent).toContain(`...tanstackConfig`)
  })

  it(`should include prettier plugin configuration`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import prettier plugin and config
    expect(configContent).toContain(
      `import prettierPlugin from "eslint-plugin-prettier"`
    )
    expect(configContent).toContain(
      `import prettierConfig from "eslint-config-prettier"`
    )

    // Should configure prettier rules
    expect(configContent).toContain(`"prettier/prettier": \`error\``)
  })

  it(`should include stylistic plugin for quote enforcement`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import and configure stylistic plugin
    expect(configContent).toContain(
      `import stylisticPlugin from "@stylistic/eslint-plugin"`
    )
    expect(configContent).toContain(`stylistic: stylisticPlugin`)
    expect(configContent).toContain(`"stylistic/quotes": [\`error\`, \`backtick\`]`)
  })

  it(`should configure TypeScript-specific rules`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should have TypeScript files override
    expect(configContent).toContain(`files: [\`**/*.ts\`, \`**/*.tsx\`]`)

    // Should allow unused vars with underscore prefix
    expect(configContent).toContain(`argsIgnorePattern: \`^_\``)
    expect(configContent).toContain(`varsIgnorePattern: \`^_\``)

    // Should enforce PascalCase for type parameters
    expect(configContent).toContain(`selector: \`typeParameter\``)
    expect(configContent).toContain(`format: [\`PascalCase\`]`)
  })

  it(`should ignore build and output directories`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    expect(configContent).toContain(`ignores: [`)
    expect(configContent).toContain(`\`**/dist/**\``)
    expect(configContent).toContain(`\`**/.output/**\``)
    expect(configContent).toContain(`\`**/.nitro/**\``)
  })

  it(`should disable pnpm catalog enforcement rules`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    expect(configContent).toContain(`"pnpm/enforce-catalog": \`off\``)
    expect(configContent).toContain(`"pnpm/json-enforce-catalog": \`off\``)
  })

  it(`should properly import and spread tanstackConfig base configuration`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // Should import tanstackConfig
    expect(configContent).toContain(`import { tanstackConfig } from "@tanstack/config/eslint"`)

    // Should spread tanstackConfig at the beginning of the config array
    expect(configContent).toMatch(/\.\.\.tanstackConfig/)
  })

  it(`should merge tanstackConfig with custom overrides correctly`, () => {
    const configContent = readFileSync(configPath, `utf-8`)

    // tanstackConfig should be spread first
    const tanstackIndex = configContent.indexOf(`...tanstackConfig`)
    const ignoresIndex = configContent.indexOf(`ignores:`)
    const pluginsIndex = configContent.indexOf(`plugins:`)

    // tanstackConfig comes before custom overrides
    expect(tanstackIndex).toBeLessThan(ignoresIndex)
    expect(tanstackIndex).toBeLessThan(pluginsIndex)
  })
})
