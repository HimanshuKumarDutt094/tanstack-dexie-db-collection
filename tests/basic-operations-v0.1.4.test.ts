// Ensure fake IndexedDB is available before any Dexie imports
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "@tanstack/db"
import { dexieCollectionOptions } from "../src/index"

describe(`Dexie Collection (TanStack DB v0.1.4)`, () => {
  const collectionsToCleanup: Array<any> = []

  beforeEach(() => {
    // Ensure IndexedDB is available
    if (typeof globalThis.indexedDB === `undefined`) {
      throw new Error(`IndexedDB is not available in test environment`)
    }
  })

  afterEach(async () => {
    // Cleanup collections
    for (const collection of collectionsToCleanup) {
      try {
        collection.destroy()
      } catch {}
    }
    collectionsToCleanup.length = 0

    // Cleanup IndexedDB databases
    const idb = globalThis.indexedDB as any
    if (idb && idb.databases) {
      const databases = await idb.databases()
      for (const db of databases) {
        if (db.name) {
          idb.deleteDatabase(db.name)
        }
      }
    }
  })

  it(`should create collection with v0.1.4 API`, () => {
    interface Todo {
      id: string
      text: string
      completed: boolean
    }

    const options = dexieCollectionOptions<Todo>({
      id: `todos-v0.1.4`,
      getKey: (item) => item.id,
    })

    expect(options).toBeDefined()
    expect(options.sync).toBeDefined()
    expect(options.getKey).toBeDefined()
    expect(options.utils).toBeDefined()
    expect(options.utils.getTable).toBeDefined()
    expect(options.utils.getNextId).toBeDefined()
  })

  it(`should work with createCollection using v0.1.4 API`, () => {
    interface Todo {
      id: string
      text: string
      completed: boolean
    }

    const options = dexieCollectionOptions<Todo>({
      id: `todos-create-v0.1.4`,
      getKey: (item) => item.id,
      startSync: true,
    })

    const collection = createCollection<Todo>({
      ...options,
      syncMode: `eager`,
    })

    collectionsToCleanup.push(collection)

    expect(collection).toBeDefined()
    expect(collection.id).toBe(`todos-create-v0.1.4`)
  })

  it(`should insert and retrieve data with v0.1.4 API`, async () => {
    interface Todo {
      id: string
      text: string
      completed: boolean
    }

    const options = dexieCollectionOptions<Todo>({
      id: `todos-data-v0.1.4`,
      getKey: (item) => item.id,
      startSync: true,
    })

    const collection = createCollection<Todo>({
      ...options,
      syncMode: `eager`,
    })

    collectionsToCleanup.push(collection)

    // Wait for collection to be ready
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Insert data
    await collection.insert({
      id: `1`,
      text: `Test todo`,
      completed: false,
    })

    // Give sync time to process
    await new Promise((resolve) => setTimeout(resolve, 100))

    const todo = collection.get(`1`)
    expect(todo).toBeDefined()
    expect(todo?.text).toBe(`Test todo`)
    expect(todo?.completed).toBe(false)
  })

  it(`should support sequential ID generation with v0.1.4 API`, async () => {
    interface Item {
      id: number
      name: string
    }

    const options = dexieCollectionOptions<Item>({
      id: `items-sequential-v0.1.4`,
      getKey: (item) => item.id,
      startSync: true,
    })

    const collection = createCollection<Item>({
      ...options,
      syncMode: `eager`,
    })

    collectionsToCleanup.push(collection)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Get first ID
    const firstId = await collection.utils.getNextId()
    expect(firstId).toBeGreaterThan(0)

    // Insert with first ID
    await collection.insert({
      id: firstId,
      name: `First item`,
    })

    // Get second ID - should be incremented
    const secondId = await collection.utils.getNextId()
    expect(secondId).toBe(firstId + 1)
  })

  it(`should support local-only operations with v0.1.4 API`, async () => {
    interface Todo {
      id: string
      text: string
    }

    const options = dexieCollectionOptions<Todo>({
      id: `todos-local-v0.1.4`,
      getKey: (item) => item.id,
      startSync: true,
    })

    const collection = createCollection<Todo>({
      ...options,
      syncMode: `eager`,
    })

    collectionsToCleanup.push(collection)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Insert locally (bypasses onInsert handler)
    await collection.utils.insertLocally({
      id: `local-1`,
      text: `Local todo`,
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const todo = collection.get(`local-1`)
    expect(todo).toBeDefined()
    expect(todo?.text).toBe(`Local todo`)

    // Update locally
    await collection.utils.updateLocally(`local-1`, {
      id: `local-1`,
      text: `Updated todo`,
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const updatedTodo = collection.get(`local-1`)
    expect(updatedTodo?.text).toBe(`Updated todo`)

    // Delete locally
    await collection.utils.deleteLocally(`local-1`)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const deletedTodo = collection.get(`local-1`)
    expect(deletedTodo).toBeUndefined()
  })

  it(`should support awaitIds with v0.1.4 API`, async () => {
    interface Todo {
      id: string
      text: string
    }

    const options = dexieCollectionOptions<Todo>({
      id: `todos-await-v0.1.4`,
      getKey: (item) => item.id,
      startSync: true,
      awaitTimeoutMs: 2000,
    })

    const collection = createCollection<Todo>({
      ...options,
      syncMode: `eager`,
    })

    collectionsToCleanup.push(collection)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Insert data
    await collection.insert({
      id: `await-1`,
      text: `Await todo`,
    })

    // Wait for ID to be observed
    await collection.utils.awaitIds([`await-1`])

    const todo = collection.get(`await-1`)
    expect(todo).toBeDefined()
  })
})
