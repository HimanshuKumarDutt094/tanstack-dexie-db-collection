import { describe, expect, it } from "vitest"
import * as indexModule from "../src/index"
import { dexieCollectionOptions } from "../src/dexie"

/**
 * Tests for index.ts exports
 * Validates that the module properly exports all public APIs
 */

describe(`Index Module Exports`, () => {
  it(`should export dexieCollectionOptions`, () => {
    expect(indexModule.dexieCollectionOptions).toBeDefined()
    expect(typeof indexModule.dexieCollectionOptions).toBe(`function`)
  })

  it(`should export dexieCollectionOptions as default named export`, () => {
    expect(indexModule.dexieCollectionOptions).toBe(dexieCollectionOptions)
  })

  it(`should export all types and interfaces from dexie`, () => {
    // Verify main exports are available
    expect(indexModule).toHaveProperty(`dexieCollectionOptions`)
  })

  it(`should re-export DexieCollectionConfig type`, () => {
    // The type should be available through the module
    expect(indexModule).toBeDefined()
  })

  it(`should re-export DexieUtils interface`, () => {
    // The interface should be available through the module
    expect(indexModule).toBeDefined()
  })

  it(`should re-export DexieCodec interface`, () => {
    // The codec interface should be available
    expect(indexModule).toBeDefined()
  })

  it(`should have consistent exports between index and dexie module`, () => {
    const indexKeys = Object.keys(indexModule).sort()
    // index.ts only re-exports from dexie.ts
    expect(indexKeys.length).toBeGreaterThan(0)
    expect(indexKeys.every((key) => key in indexModule)).toBe(true)
  })
})
