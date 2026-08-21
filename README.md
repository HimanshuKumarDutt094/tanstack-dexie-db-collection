# tanstack-dexie-db-collection

Coleção Dexie para **TanStack DB v0.6.0+** com persistência em IndexedDB.

## Instalação

```bash
pnpm install tanstack-dexie-db-collection @tanstack/db dexie
```

## Uso Básico

```typescript
import { createCollection } from '@tanstack/db'
import { dexieCollectionOptions } from 'tanstack-dexie-db-collection'

interface Todo {
  id: string
  text: string
  completed: boolean
}

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    dbName: 'my-app-db',
    startSync: true,
  })
)

// Inserir dados
await todosCollection.insert({
  id: '1',
  text: 'Learn TanStack DB',
  completed: false,
})

// Recuperar dados
const todo = todosCollection.get('1')
```

## Com Schema (Zod)

```typescript
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { dexieCollectionOptions } from 'tanstack-dexie-db-collection'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  dexieCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
  })
)
```

## Utilitários Disponíveis

A biblioteca inclui utilitários para operações avançadas:

```typescript
// Acesso à tabela Dexie
const table = collection.utils.getTable()

// Inserir localmente (sem trigger de handlers)
await collection.utils.insertLocally({ id: '1', text: 'Local' })

// Atualizar localmente
await collection.utils.updateLocally('1', { id: '1', text: 'Updated' })

// Deletar localmente
await collection.utils.deleteLocally('1')

// Gerar ID sequencial
const nextId = await collection.utils.getNextId()

// Aguardar IDs serem observados
await collection.utils.awaitIds(['1', '2', '3'])

// Refresh manual
await collection.utils.refetch()
```

## Configurações

### Opções de Configuração

```typescript
dexieCollectionOptions({
  id: 'todos',                    // ID da coleção e nome da tabela
  dbName: 'my-app-db',            // Nome do banco IndexedDB (padrão: 'app-db')
  tableName: 'todos',             // Nome da tabela (padrão: id)
  getKey: (item) => item.id,      // Função para extrair chave única
  schema: todoSchema,             // Schema Zod (opcional)
  startSync: true,                // Iniciar sync imediatamente
  syncBatchSize: 1000,            // Tamanho do batch inicial
  rowUpdateMode: 'partial',       // 'partial' ou 'full'
  ackTimeoutMs: 2000,             // Timeout para ack
  awaitTimeoutMs: 10000,          // Timeout para awaitIds
  
  // Handlers de persistência opcionais
  onInsert: async ({ transaction }) => {
    // Sync com backend
  },
  onUpdate: async ({ transaction }) => {
    // Sync com backend
  },
  onDelete: async ({ transaction }) => {
    // Sync com backend
  },
})
```

## Testes

```bash
pnpm test
```

## Compatibilidade

Esta biblioteca é compatível com **TanStack DB v0.6.0+** e **Dexie 4.x**.

### Recursos Suportados

- ✅ `createCollection()` API
- ✅ Sincronização reativa com `liveQuery`
- ✅ Atualizações otimistas com ack tracking
- ✅ Handlers de persistência opcionais
- ✅ Codecs para transformação de dados
- ✅ Geração de IDs sequenciais
- ✅ Operações bulk

## License

MIT
