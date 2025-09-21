import "./fake-db"
import { afterEach, describe, expect, it } from "vitest"
import { createCollection } from "@tanstack/db"
import { dexieCollectionOptions } from "../src/dexie"
import {
  cleanupTestResources,
  createDexieDatabase,
  createTestState,
  waitForKey,
} from "./test-helpers"

describe(`Dexie persistence handlers`, () => {
  afterEach(cleanupTestResources)

  it(`fire-and-forget onInsert still persists locally and calls backend`, async () => {
    const { db } = await createTestState()

    let called = false
    let capturedTx: any = null

    // create a collection with a user-provided onInsert but default awaitPersistence = false
    const opts = dexieCollectionOptions({
      id: `pf1`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      onInsert: async ({ transaction }) => {
        // capture transaction for assertions (single insert)
        capturedTx = transaction
        // simulate async backend work
        await new Promise((r) => setTimeout(r, 50))
        called = true
      },
    })

    const col = createCollection(opts)
    await col.stateWhenReady()

    const tx = col.insert({ id: `p1`, name: `P` })
    // persisted should resolve even if backend callback is pending
    await tx.isPersisted.promise

    // local data should be present
    await waitForKey(col, `p1`, 500)
    expect(col.get(`p1`)?.name).toBe(`P`)

    // give backend callback a chance to run
    await new Promise((r) => setTimeout(r, 80))
    expect(called).toBe(true)
    // ensure handler saw the transaction and its mutation
    expect(capturedTx).not.toBeNull()
    expect(capturedTx.mutations.length).toBe(1)
    expect(capturedTx.mutations[0].modified.name).toBe(`P`)
  })

  it(`awaitPersistence true waits for user callback to complete`, async () => {
    const db = await createDexieDatabase([])

    let calledAt = 0
    let capturedTx2: any = null
    const opts = dexieCollectionOptions({
      id: `await-ok`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      onInsert: async ({ transaction }) => {
        // capture transaction and simulate backend delay
        capturedTx2 = transaction
        await new Promise((r) => setTimeout(r, 70))
        calledAt = Date.now()
      },
    })

    const col = createCollection(opts)
    await col.stateWhenReady()

    const start = Date.now()
    const tx = col.insert({ id: `a1`, name: `A` })
    await tx.isPersisted.promise
    const ended = Date.now()

    // Ensure we waited at least the backend delay
    expect(ended - start).toBeGreaterThanOrEqual(70)
    expect(calledAt).toBeGreaterThan(0)
    await waitForKey(col, `a1`, 500)
    expect(capturedTx2).not.toBeNull()
    expect(capturedTx2.mutations[0].modified.name).toBe(`A`)
  })

  it(`awaitPersistence with throwing callback: swallowed vs propagated`, async () => {
    const db = await createDexieDatabase([])

    // swallowed error (default)
    // capture not used in assertions; handler will throw to test swallowing
    const optsSwallow = dexieCollectionOptions({
      id: `swallow`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      // default swallowPersistenceErrors: true
      onInsert: async ({ transaction: _transaction }) => {
        await Promise.resolve()
        throw new Error(`backend-failed`)
      },
    })

    const colSwallow = createCollection(optsSwallow)
    await colSwallow.stateWhenReady()

    const tx1 = colSwallow.insert({ id: `s1`, name: `S` })
    // should resolve because error is swallowed
    await tx1.isPersisted.promise
    await waitForKey(colSwallow, `s1`, 500)

    // propagated error when swallowPersistenceErrors=false
    const optsProp = dexieCollectionOptions({
      id: `prop`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      swallowPersistenceErrors: false,
      onInsert: async ({ transaction }) => {
        await Promise.resolve()
        ;(transaction as any).__captured = true
        throw new Error(`backend-failed-2`)
      },
    })

    const colProp = createCollection(optsProp)
    await colProp.stateWhenReady()

    const tx2 = colProp.insert({ id: `p1`, name: `P` })
    await expect(tx2.isPersisted.promise).rejects.toThrow(`backend-failed-2`)
    // the transaction object should have been passed into handler (best-effort)
    // note: we cannot directly access the handler's local variable here, but the handler
    // marked the transaction to indicate it received it.
  })

  it(`persistence timeout behavior with swallow vs propagate`, async () => {
    const db = await createDexieDatabase([])

    // never-resolving handler, timeout should occur
    let capturedTimeout: any = null
    const optsTimeoutSwallow = dexieCollectionOptions({
      id: `t1`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      persistenceTimeoutMs: 50,
      // default swallow = true
      onInsert: ({ transaction }) => {
        // capture transaction then hang so timeout will trigger
        capturedTimeout = transaction
        return new Promise(() => {})
      },
    })

    const colT1 = createCollection(optsTimeoutSwallow)
    await colT1.stateWhenReady()
    const tx1 = colT1.insert({ id: `t-a`, name: `TA` })
    // should resolve because timeout error is swallowed
    await tx1.isPersisted.promise
    await waitForKey(colT1, `t-a`, 500)

    // when not swallowing, expect rejection due to timeout
    let capturedTimeout2: any = null
    const optsTimeoutProp = dexieCollectionOptions({
      id: `t2`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      persistenceTimeoutMs: 30,
      swallowPersistenceErrors: false,
      onInsert: ({ transaction }) => {
        capturedTimeout2 = transaction
        return new Promise(() => {})
      },
    })

    const colT2 = createCollection(optsTimeoutProp)
    await colT2.stateWhenReady()
    const tx2 = colT2.insert({ id: `t-b`, name: `TB` })
    await expect(tx2.isPersisted.promise).rejects.toThrow(`persistence:timeout`)
    expect(capturedTimeout).not.toBeNull()
    expect(capturedTimeout2).not.toBeNull()
  })

  it(`dexie write failure prevents persistence handler from running and propagates error`, async () => {
    const db = await createDexieDatabase([])

    let handlerCalled = false

    const opts = dexieCollectionOptions({
      id: `dexie-fail`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      onInsert: () => {
        handlerCalled = true
      },
    })

    const col = createCollection(opts)
    await col.stateWhenReady()

    // monkeypatch bulkPut to throw on the collection's table
    const table = col.utils.getTable() as any
    const orig = table.bulkPut
    table.bulkPut = () => {
      throw new Error(`simulated-bulkput-failure`)
    }

    const tx = col.insert({ id: `x1`, name: `X` })
    await expect(tx.isPersisted.promise).rejects.toThrow(
      `simulated-bulkput-failure`
    )

    // handler should NOT have been called because write failed
    expect(handlerCalled).toBe(false)

    // DB should not contain the row
    const row = await db.table(`test`).get(`x1`)
    expect(row).toBeUndefined()

    // restore
    table.bulkPut = orig
  })

  it(`onUpdate/onDelete parity: await, throw/swallow, and timeout`, async () => {
    const db = await createDexieDatabase([])

    // onUpdate: await success
    let seenUpdateTx: any = null
    const optsU = dexieCollectionOptions({
      id: `u-await`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      onUpdate: async ({ transaction }) => {
        seenUpdateTx = transaction
        await new Promise((r) => setTimeout(r, 20))
      },
    })

    const colU = createCollection(optsU)
    await colU.stateWhenReady()

    const txU = colU.insert({ id: `u1`, name: `U1` })
    await txU.isPersisted.promise
    const updTx = colU.update(`u1`, (d: any) => (d.name = `U1b`))
    // wait for update persistence
    await updTx.isPersisted.promise

    expect(seenUpdateTx).not.toBeNull()
    expect(seenUpdateTx.mutations.some((m: any) => m.type === `update`)).toBe(
      true
    )

    // onDelete: await throw swallowed vs propagated
    // swallowed
    const optsDelSw = dexieCollectionOptions({
      id: `del-sw`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      onDelete: async ({ transaction: _transaction }) => {
        await Promise.resolve()
        throw new Error(`delete-failed`)
      },
    })

    const colDelSw = createCollection(optsDelSw)
    await colDelSw.stateWhenReady()

    const txIns = colDelSw.insert({ id: `d1`, name: `D1` })
    await txIns.isPersisted.promise
    await waitForKey(colDelSw, `d1`, 500)
    const txDel = colDelSw.delete(`d1`)
    // should resolve because swallow default true
    await txDel.isPersisted.promise

    // propagated when swallowPersistenceErrors=false
    const optsDelProp = dexieCollectionOptions({
      id: `del-prop`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      awaitPersistence: true,
      swallowPersistenceErrors: false,
      onDelete: async ({ transaction: _transaction }) => {
        await Promise.resolve()
        throw new Error(`delete-failed-2`)
      },
    })

    const colDelProp = createCollection(optsDelProp)
    await colDelProp.stateWhenReady()

    const txIns2 = colDelProp.insert({ id: `d2`, name: `D2` })
    await txIns2.isPersisted.promise
    await waitForKey(colDelProp, `d2`, 500)
    const txDel2 = colDelProp.delete(`d2`)
    await expect(txDel2.isPersisted.promise).rejects.toThrow(`delete-failed-2`)
  })

  it(`mixed transaction: insert+update+delete in one handler payload`, async () => {
    const initial = [
      { id: `m1`, name: `M1` },
      { id: `m2`, name: `M2` },
    ]
    const { db } = await createTestState(initial)

    let captured: any = null
    const opts = dexieCollectionOptions({
      id: `mixed`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      onInsert: ({ transaction: _transaction }) => {
        // noop
      },
      onUpdate: ({ transaction }) => {
        captured = transaction
      },
    })

    const col = createCollection(opts)
    await col.stateWhenReady()

    // Perform operations on the collection with handlers
    col.insert({ id: `m3`, name: `M3` })
    const upd = col.update(`m1`, (d: any) => (d.name = `M1u`))
    col.delete(`m2`)

    await upd.isPersisted.promise
    await new Promise((r) => setTimeout(r, 50))

    expect(captured).not.toBeNull()
    const types = captured.mutations.map((m: any) => m.type)
    expect(types).toEqual(expect.arrayContaining([`update`]))
  })

  it(`rowUpdateMode full vs partial: handler sees expected payload`, async () => {
    const db = await createDexieDatabase([])

    // partial (default)
    let partialSeen: any = null
    const optsP = dexieCollectionOptions({
      id: `row-partial`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      onUpdate: ({ transaction }) => {
        partialSeen = transaction
      },
    })

    const colP = createCollection(optsP)
    await colP.stateWhenReady()
    const ins = colP.insert({ id: `r1`, name: `R1` })
    await ins.isPersisted.promise
    await waitForKey(colP, `r1`, 500)
    const updTxP = colP.update(`r1`, (d: any) => (d.name = `R1p`))
    await updTxP.isPersisted.promise

    expect(partialSeen).not.toBeNull()
    expect(partialSeen.mutations[0].changes).toBeDefined()

    // full mode
    let fullSeen: any = null
    const optsF = dexieCollectionOptions({
      id: `row-full`,
      tableName: `test`,
      dbName: db.name,
      getKey: (i: any) => i.id,
      rowUpdateMode: `full`,
      onUpdate: ({ transaction }) => {
        fullSeen = transaction
      },
    })

    const colF = createCollection(optsF)
    await colF.stateWhenReady()
    const ins2 = colF.insert({ id: `r2`, name: `R2` })
    await ins2.isPersisted.promise
    await waitForKey(colF, `r2`, 500)
    const updTxF = colF.update(`r2`, (d: any) => {
      d.name = `R2f`
    })
    await updTxF.isPersisted.promise

    expect(fullSeen).not.toBeNull()
    expect(fullSeen.mutations[0].modified).toBeDefined()
  })
})
