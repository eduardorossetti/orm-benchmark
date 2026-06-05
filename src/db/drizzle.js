import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './drizzle-schema.js'
import { pgPoolConfig } from './pool-config.js'

const pool = new pg.Pool(pgPoolConfig)

export const db = drizzle(pool, { schema })
export const closeDb = () => pool.end()
