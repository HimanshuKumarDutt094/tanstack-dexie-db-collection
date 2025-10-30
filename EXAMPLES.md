# Examples

This file contains longer combination examples that demonstrate integration patterns with `dexieCollectionOptions`. Keep `README.md` concise — use this file for copy-paste-ready examples.

Note: Examples show optimistic UI patterns and persistence handler usage for clarity. This driver writes changes locally immediately and does not automatically roll back local writes on backend failure. Add retries, rollback or conflict-resolution logic inside your persistence handlers when needed. Also note the driver stores metadata fields `_updatedAt` and `_createdAt` in the Dexie table; codecs must account for these if you transform stored shapes.

---

## Complete React Todo App

```typescript
import React, { useState } from "react"
import { createCollection } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { dexieCollectionOptions } from "tanstack-dexie-db-collection"
import { z } from "zod"

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.date(),
})

type Todo = z.infer<typeof todoSchema>

// Create collection with backend sync
const todosCollection = createCollection(
  dexieCollectionOptions({
    id: "todos",
    schema: todoSchema,
    getKey: (item) => item.id,

    // Optimistic updates with background sync
    awaitPersistence: false,
    swallowPersistenceErrors: true,

    onInsert: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        try {
          await todoAPI.create(mutation.modified)
        } catch (error) {
          console.error("Backend sync failed for insert:", error)
        }
      }
    },

    onUpdate: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        try {
          await todoAPI.update(
            mutation.key,
            mutation.changes || mutation.modified
          )
        } catch (error) {
          console.error("Backend sync failed for update:", error)
        }
      }
    },

    onDelete: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        try {
          await todoAPI.delete(mutation.key)
        } catch (error) {
          console.error("Backend sync failed for delete:", error)
        }
      }
    },
  })
)

function TodoApp() {
  const { data: todos = [] } = useLiveQuery(todosCollection)
  const [newTodoText, setNewTodoText] = useState("")

  const addTodo = async () => {
    if (!newTodoText.trim()) return

    const tx = todosCollection.insert({
      id: crypto.randomUUID(),
      text: newTodoText.trim(),
      completed: false,
      createdAt: new Date(),
    })

    await tx.isPersisted.promise
    setNewTodoText("")
  }

  const toggleTodo = async (id: string) => {
    const tx = todosCollection.update(id, (todo) => {
      todo.completed = !todo.completed
    })
    await tx.isPersisted.promise
  }

  const deleteTodo = async (id: string) => {
    const tx = todosCollection.delete(id)
    await tx.isPersisted.promise
  }

  return (
    <div className="todo-app">
      <h1>Todos ({todos.length})</h1>

      <div className="add-todo">
        <input
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          placeholder="Add a todo..."
          onKeyPress={(e) => e.key === "Enter" && addTodo()}
        />
        <button onClick={addTodo}>Add</button>
      </div>

      <ul className="todo-list">
        {todos
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((todo) => (
            <li key={todo.id} className={todo.completed ? "completed" : ""}>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
              />
              <span>{todo.text}</span>
              <button onClick={() => deleteTodo(todo.id)}>Delete</button>
            </li>
          ))}
      </ul>
    </div>
  )
}

export default TodoApp
```

---

## E-commerce Product Catalog

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  category: z.string(),
  inStock: z.boolean(),
  lastUpdated: z.date(),
})

const productsCollection = createCollection(
  dexieCollectionOptions({
    id: "products",
    schema: productSchema,
    getKey: (product) => product.id,
    dbName: "ecommerce-app",
    syncBatchSize: 100,

    codec: {
      serialize: (product) => ({
        ...product,
        lastUpdated: product.lastUpdated.toISOString(),
      }),
      parse: (stored) => ({
        ...stored,
        lastUpdated: new Date(stored.lastUpdated),
      }),
    },

    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map((m) => ({
        id: m.key,
        changes: m.changes,
      }))

      await fetch("/api/products/bulk-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
    },
  })
)
```

---

## User Profile Management

```typescript
const userProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(),
  preferences: z.object({
    theme: z.enum(["light", "dark"]),
    notifications: z.boolean(),
  }),
  lastSeen: z.date(),
})

const userProfileCollection = createCollection(
  dexieCollectionOptions({
    id: "user-profiles",
    schema: userProfileSchema,
    getKey: (user) => user.id,

    awaitPersistence: true,
    persistenceTimeoutMs: 8000,

    onUpdate: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        await fetch(`/api/users/${mutation.key}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mutation.changes || mutation.modified),
        })
      }
    },
  })
)

function UserSettings() {
  const { data: users = [] } = useLiveQuery(userProfileCollection)
  const currentUser = users[0]

  const updatePreferences = async (newPrefs: any) => {
    const tx = userProfileCollection.update(currentUser.id, (user) => {
      user.preferences = { ...user.preferences, ...newPrefs }
    })

    try {
      await tx.isPersisted.promise
      showNotification("Settings saved!", "success")
    } catch (error) {
      showNotification("Failed to save settings", "error")
    }
  }
}
```

---

## Chat Messages with Real-time Sync

```typescript
const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  content: z.string(),
  timestamp: z.date(),
  status: z.enum(["sending", "sent", "delivered", "read"]),
})

const messagesCollection = createCollection(
  dexieCollectionOptions({
    id: "messages",
    schema: messageSchema,
    getKey: (message) => message.id,

    awaitPersistence: false,

    onInsert: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const message = mutation.modified
        await sendMessageToServer(message)
        messagesCollection.update(message.id, (msg) => {
          msg.status = "sent"
        })
      }
    },
  })
)

function ChatWindow({ chatId }: { chatId: string }) {
  const { data: allMessages = [] } = useLiveQuery(messagesCollection)
  const chatMessages = allMessages.filter((msg) => msg.chatId === chatId)

  const sendMessage = async (content: string) => {
    const newMessage = {
      id: crypto.randomUUID(),
      chatId,
      senderId: getCurrentUserId(),
      content,
      timestamp: new Date(),
      status: "sending" as const,
    }

    messagesCollection.insert(newMessage)
  }
}
```

---

## Bootstrap from Server (Initial Data Load)

```typescript
const productsCollection = createCollection(
  dexieCollectionOptions({
    id: "products",
    schema: productSchema,
    getKey: (product) => product.id,

    // Handlers for user-initiated changes
    onInsert: async ({ transaction }) => {
      await api.products.create(transaction.mutations[0].modified)
    },
  })
)

// Bootstrap function - loads initial data without triggering onInsert
async function bootstrapProducts() {
  const lastSync = localStorage.getItem("products-last-sync")

  // Fetch all products from server
  const serverProducts = await fetch("/api/products").then((r) => r.json())

  // Write directly to local storage without triggering handlers
  await productsCollection.utils.bulkInsertLocally(serverProducts)

  localStorage.setItem("products-last-sync", new Date().toISOString())
  console.log(`Bootstrapped ${serverProducts.length} products`)
}

// Call on app startup
bootstrapProducts()
```

---

## Incremental Sync from Server

```typescript
const notesCollection = createCollection(
  dexieCollectionOptions({
    id: "notes",
    schema: noteSchema,
    getKey: (note) => note.id,

    onInsert: async ({ transaction }) => {
      await api.notes.create(transaction.mutations[0].modified)
    },
    onUpdate: async ({ transaction }) => {
      await api.notes.update(
        transaction.mutations[0].key,
        transaction.mutations[0].changes
      )
    },
    onDelete: async ({ transaction }) => {
      await api.notes.delete(transaction.mutations[0].key)
    },
  })
)

// Incremental sync - only fetch changes since last sync
async function syncNotes() {
  const lastSync = localStorage.getItem("notes-last-sync")

  // Fetch only changes since last sync
  const changes = await fetch(
    `/api/notes/changes?since=${lastSync}`
  ).then((r) => r.json())

  // Apply changes locally without triggering handlers
  if (changes.created.length > 0) {
    await notesCollection.utils.bulkInsertLocally(changes.created)
  }

  if (changes.updated.length > 0) {
    await notesCollection.utils.bulkUpdateLocally(changes.updated)
  }

  if (changes.deleted.length > 0) {
    await notesCollection.utils.bulkDeleteLocally(changes.deleted)
  }

  localStorage.setItem("notes-last-sync", new Date().toISOString())
  console.log(
    `Synced: ${changes.created.length} created, ${changes.updated.length} updated, ${changes.deleted.length} deleted`
  )
}

// Sync periodically
setInterval(syncNotes, 60000) // Every minute
```

---

## WebSocket Real-time Updates

```typescript
const messagesCollection = createCollection(
  dexieCollectionOptions({
    id: "messages",
    schema: messageSchema,
    getKey: (message) => message.id,

    // Handler for user sending messages
    onInsert: async ({ transaction }) => {
      const message = transaction.mutations[0].modified
      await api.messages.send(message)
    },
  })
)

// WebSocket connection for real-time updates from other users
const ws = new WebSocket("wss://api.example.com/messages")

ws.onmessage = async (event) => {
  const update = JSON.parse(event.data)

  switch (update.type) {
    case "message:created":
      // Write directly without triggering onInsert
      await messagesCollection.utils.insertLocally(update.message)
      break

    case "message:updated":
      await messagesCollection.utils.updateLocally(
        update.message.id,
        update.message
      )
      break

    case "message:deleted":
      await messagesCollection.utils.deleteLocally(update.messageId)
      break

    case "messages:bulk":
      // Handle bulk updates efficiently
      await messagesCollection.utils.bulkInsertLocally(update.messages)
      break
  }
}

// User sends a message (triggers onInsert handler)
async function sendMessage(content: string) {
  await messagesCollection.insert({
    id: crypto.randomUUID(),
    content,
    senderId: getCurrentUserId(),
    timestamp: new Date(),
  })
}
```

---

## Offline-First with Background Sync

```typescript
const tasksCollection = createCollection(
  dexieCollectionOptions({
    id: "tasks",
    schema: taskSchema,
    getKey: (task) => task.id,

    // Fire-and-forget sync to server
    awaitPersistence: false,
    swallowPersistenceErrors: true,

    onInsert: async ({ transaction }) => {
      try {
        await api.tasks.create(transaction.mutations[0].modified)
      } catch (error) {
        console.error("Failed to sync task to server:", error)
        // Task is still saved locally
      }
    },
  })
)

// Bootstrap on app start
async function initializeTasks() {
  try {
    // Fetch latest from server
    const serverTasks = await api.tasks.list()

    // Merge with local data (server is source of truth)
    await tasksCollection.utils.bulkInsertLocally(serverTasks)

    console.log("Tasks synchronized")
  } catch (error) {
    console.log("Offline mode - using local data")
  }
}

// Periodic background sync
async function backgroundSync() {
  if (!navigator.onLine) return

  try {
    const lastSync = localStorage.getItem("tasks-last-sync")
    const changes = await api.tasks.changes(lastSync)

    await tasksCollection.utils.bulkInsertLocally(changes.created)
    await tasksCollection.utils.bulkUpdateLocally(changes.updated)
    await tasksCollection.utils.bulkDeleteLocally(changes.deleted)

    localStorage.setItem("tasks-last-sync", new Date().toISOString())
  } catch (error) {
    console.error("Background sync failed:", error)
  }
}

// Initialize and start background sync
initializeTasks()
setInterval(backgroundSync, 30000) // Every 30 seconds
```

---

## Server-Sent Events (SSE) Integration

```typescript
const notificationsCollection = createCollection(
  dexieCollectionOptions({
    id: "notifications",
    schema: notificationSchema,
    getKey: (notification) => notification.id,

    // Handler for user marking notifications as read
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0]
      await api.notifications.markRead(mutation.key)
    },
  })
)

// SSE connection for real-time notifications
const eventSource = new EventSource("/api/notifications/stream")

eventSource.addEventListener("notification", async (event) => {
  const notification = JSON.parse(event.data)

  // Write directly without triggering handlers
  await notificationsCollection.utils.insertLocally(notification)

  // Show browser notification
  if (Notification.permission === "granted") {
    new Notification(notification.title, {
      body: notification.message,
    })
  }
})

eventSource.addEventListener("notification:read", async (event) => {
  const { id } = JSON.parse(event.data)
  await notificationsCollection.utils.updateLocally(id, {
    id,
    read: true,
    readAt: new Date(),
  })
})

// User marks notification as read (triggers onUpdate handler)
async function markAsRead(notificationId: string) {
  await notificationsCollection.update(notificationId, (notification) => {
    notification.read = true
    notification.readAt = new Date()
  })
}
```

---

## Comparison: Regular vs Local Write Utilities

```typescript
const collection = createCollection(
  dexieCollectionOptions({
    id: "items",
    getKey: (item) => item.id,

    onInsert: async ({ transaction }) => {
      console.log("onInsert called - syncing to server")
      await api.items.create(transaction.mutations[0].modified)
    },
  })
)

// ❌ Regular insert - triggers onInsert handler
await collection.insert({ id: "1", name: "Item 1" })
// Console: "onInsert called - syncing to server"

// ✅ Local insert - does NOT trigger onInsert handler
await collection.utils.insertLocally({ id: "2", name: "Item 2" })
// No console output - handler not called

// Use cases:
// - Regular insert: User creates new item → sync to server
// - Local insert: Server sends new item → write locally only
```

---

## Notes

- These examples are intentionally compact — they demonstrate the shape and usage
  of `dexieCollectionOptions` and the recommended patterns (optimistic vs awaited
  persistence, codecs, update modes, local write utilities).
- **Local write utilities** (`insertLocally`, `updateLocally`, `deleteLocally`) are
  essential for bootstrap, sync, and real-time update scenarios where you want to
  write data locally without triggering persistence handlers.
- For full app code, copy the snippet and adapt to your needs.

---
