import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { pgPoolConfig } from './pool-config.js'

const adapter = new PrismaPg(pgPoolConfig)
const prisma = new PrismaClient({ adapter })

export default prisma
