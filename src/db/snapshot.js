import postgres from 'postgres'

export const TABLES = ['users', 'addresses', 'products', 'carts', 'cart_items']

const SNAPSHOT_DIR = '/snapshot'

function connect() {
  return postgres(process.env.DATABASE_URL, { max: 1 })
}

export async function snapshot() {
  const sql = connect()
  try {
    for (const table of TABLES) {
      const path = `${SNAPSHOT_DIR}/${table}.csv`
      await sql.unsafe(`COPY ${table} TO '${path}' WITH (FORMAT csv, HEADER true)`)
    }
  } finally {
    await sql.end()
  }
}

export async function resetFast() {
  const sql = connect()
  try {
    await sql.unsafe(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)
    for (const table of TABLES) {
      const path = `${SNAPSHOT_DIR}/${table}.csv`
      await sql.unsafe(`COPY ${table} FROM '${path}' WITH (FORMAT csv, HEADER true)`)
      await sql.unsafe(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`
      )
    }
    await sql.unsafe('ANALYZE')
    await sql.unsafe('CHECKPOINT')
  } finally {
    await sql.end()
  }
}
