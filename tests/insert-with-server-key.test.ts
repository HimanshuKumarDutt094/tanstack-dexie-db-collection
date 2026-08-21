import "./fake-db"
import { createCollection } from "@tanstack/db"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { dexieCollectionOptions } from "../src"
import { cleanupTestResources, createdCollections } from "./test-helpers"
import { createDexieDatabase } from "./test-helpers"

const ServerKeySchema = z.object({
  id: z.number(),
  name: z.string(),
})
type ServerKeyItem = z.infer<typeof ServerKeySchema>

async function makeCollection(
  getServerKey?: (item: ServerKeyItem) => Promise<string | number>,
) {
  const db = await createDexieDatabase([])
  const options = dexieCollectionOptions<typeof ServerKeySchema>({
    id: `test`,
    tableName: `test`,
    dbName: db.name,
    schema: ServerKeySchema,
    getKey: (item) => item.id,
    ...(getServerKey ? { getServerKey } : {}),
  })
  const collection = createCollection(options)
  await collection.stateWhenReady()
  createdCollections.push(collection)
  const utils = collection.utils as any
  if (utils.refetch) await utils.refetch()
  return { collection, db, utils }
}

describe(`insertWithServerKey / hasServerKey`, () => {
  afterEach(cleanupTestResources)

  it(`hasServerKey is false when getServerKey is not configured`, async () => {
    const { utils } = await makeCollection()
    expect(utils.hasServerKey).toBe(false)
  })

  it(`hasServerKey is true when getServerKey is configured`, async () => {
    const { utils } = await makeCollection(async () => 42)
    expect(utils.hasServerKey).toBe(true)
  })

  it(`insertWithServerKey throws when getServerKey is not configured`, async () => {
    const { utils } = await makeCollection()
    await expect(
      utils.insertWithServerKey({ name: `x` }),
    ).rejects.toThrow(/getServerKey/)
  })

  it(`inserts locally with the server-assigned id`, async () => {
    const getServerKey = vi.fn(async () => 7)
    const { collection, utils } = await makeCollection(getServerKey)

    const result = await utils.insertWithServerKey({ name: `hello` })

    expect(getServerKey).toHaveBeenCalledWith({ name: `hello` })
    expect(result.id).toBe(7)
    // Mirrored into the collection under the server id.
    await new Promise((r) => setTimeout(r, 50))
    if (utils.refetch) await utils.refetch()
    expect(collection.get(7)).toMatchObject({ id: 7, name: `hello` })
  })

  it(`does NOT write locally when getServerKey rejects`, async () => {
    const getServerKey = vi.fn(async () => {
      throw new Error(`server down`)
    })
    const { collection, utils } = await makeCollection(getServerKey)

    await expect(
      utils.insertWithServerKey({ name: `nope` }),
    ).rejects.toThrow(/server down/)

    await new Promise((r) => setTimeout(r, 50))
    if (utils.refetch) await utils.refetch()
    expect(collection.size).toBe(0)
  })
})
