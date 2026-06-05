import { faker } from '@faker-js/faker'
import postgres from 'postgres'

faker.seed(12345)

const sql = postgres(process.env.DATABASE_URL)

const USERS           = 10_000
const PRODUCTS        =  1_000
const UNSOLD_PRODUCTS =    100
const BATCH           =  5_000

async function bulkInsert(table, rows, columns, { returnIds = false } = {}) {
  const ids = []
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    if (returnIds) {
      const inserted = await sql`
        INSERT INTO ${sql(table)} ${sql(slice, ...columns)} RETURNING id
      `
      ids.push(...inserted)
    } else {
      await sql`INSERT INTO ${sql(table)} ${sql(slice, ...columns)}`
    }
  }
  return ids
}

const NOW = Date.now()
const DAY_MS = 24 * 60 * 60 * 1000
const randomDateInLast = (days) =>
  new Date(NOW - faker.number.float({ min: 0, max: days }) * DAY_MS)

async function seed() {
  console.log('Limpando tabelas...')
  await sql`TRUNCATE cart_items, carts, addresses, products, users RESTART IDENTITY CASCADE`
  await sql`SELECT pg_stat_statements_reset()`

  console.log(`Inserindo ${PRODUCTS} produtos...`)
  const productRows = Array.from({ length: PRODUCTS }, () => ({
    name:       faker.commerce.productName(),
    category:   faker.commerce.department(),
    price:      parseFloat(faker.commerce.price({ min: 5, max: 500 })),
    stock:      faker.number.int({ min: 0, max: 1000 }),
    created_at: randomDateInLast(90),
  }))
  const products = await bulkInsert('products', productRows, ['name', 'category', 'price', 'stock', 'created_at'], { returnIds: true })

  console.log(`Inserindo ${USERS} usuários...`)
  const userRows = Array.from({ length: USERS }, (_, i) => ({
    name:       faker.person.fullName(),
    email:      `user_${i}_${faker.internet.email()}`,
    city:       faker.location.city(),
    created_at: randomDateInLast(90),
  }))
  const users = await bulkInsert('users', userRows, ['name', 'email', 'city', 'created_at'], { returnIds: true })

  console.log('Inserindo endereços (1 por usuário)...')
  const addressRows = users.map(u => ({
    user_id:  u.id,
    street:   faker.location.streetAddress(),
    city:     faker.location.city(),
    state:    faker.location.state(),
    zip_code: faker.location.zipCode(),
  }))
  await bulkInsert('addresses', addressRows, ['user_id', 'street', 'city', 'state', 'zip_code'])

  console.log('Inserindo carrinhos (distribuição skewed, média ~1.5 por usuário)...')
  const cartRows = []
  for (const u of users) {
    const r = faker.number.float({ min: 0, max: 1 })
    let count
    if      (r < 0.30) count = 0
    else if (r < 0.65) count = 1
    else if (r < 0.85) count = 2
    else if (r < 0.94) count = 3
    else if (r < 0.98) count = 4
    else               count = faker.number.int({ min: 5, max: 8 })
    for (let i = 0; i < count; i++) {
      cartRows.push({ user_id: u.id, created_at: randomDateInLast(90) })
    }
  }
  const carts = await bulkInsert('carts', cartRows, ['user_id', 'created_at'], { returnIds: true })

  console.log('Inserindo itens dos carrinhos (2–5 por carrinho)...')
  const itemRows = carts.flatMap(c => {
    const count = faker.number.int({ min: 2, max: 5 })
    return Array.from({ length: count }, () => ({
      cart_id:    c.id,
      product_id: faker.helpers.arrayElement(products).id,
      quantity:   faker.number.int({ min: 1, max: 10 }),
      unit_price: parseFloat(faker.commerce.price({ min: 5, max: 500 })),
    }))
  })
  await bulkInsert('cart_items', itemRows, ['cart_id', 'product_id', 'quantity', 'unit_price'])

  console.log(`Inserindo ${UNSOLD_PRODUCTS} produtos nunca vendidos...`)
  const unsoldRows = Array.from({ length: UNSOLD_PRODUCTS }, () => ({
    name:       faker.commerce.productName(),
    category:   faker.commerce.department(),
    price:      parseFloat(faker.commerce.price({ min: 5, max: 500 })),
    stock:      faker.number.int({ min: 0, max: 1000 }),
    created_at: randomDateInLast(90),
  }))
  await bulkInsert('products', unsoldRows, ['name', 'category', 'price', 'stock', 'created_at'])

  console.log('\nPronto! Inseridos:')
  console.log(`  ${(PRODUCTS + UNSOLD_PRODUCTS).toLocaleString()} produtos (${UNSOLD_PRODUCTS} nunca vendidos)`)
  console.log(`  ${USERS.toLocaleString()} usuários`)
  console.log(`  ${addressRows.length.toLocaleString()} endereços`)
  console.log(`  ${carts.length.toLocaleString()} carrinhos`)
  console.log(`  ${itemRows.length.toLocaleString()} itens de carrinho`)

  await sql.end()
}

seed().catch(err => { console.error(err); process.exit(1) })
