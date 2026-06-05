import pg from 'pg'
import { pgPoolConfig } from './pool-config.js'

const pool = new pg.Pool(pgPoolConfig)

export default pool
