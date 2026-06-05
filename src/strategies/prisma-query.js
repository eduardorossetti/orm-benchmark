import prisma from '../db/prisma.js'
import { prismaStrategy } from './prisma.js'

const num = (d) => (d == null ? 0 : Number(d))

export const prismaQueryStrategy = {
  ...prismaStrategy,
  name: 'prisma-query',

  cart_detail: ({ cartId }) =>
    prisma.cartItem.findMany({
      where:                { cartId },
      include:              { product: true },
      relationLoadStrategy: 'query',
    }),

  eager_join: ({ cartIds }) =>
    prisma.cart.findMany({
      where:                { id: { in: cartIds } },
      include:              { items: { include: { product: true } } },
      relationLoadStrategy: 'query',
    }),

  recent_carts_7d: ({ since }) =>
    prisma.cart.findMany({
      where:                { createdAt: { gte: since } },
      orderBy:              { createdAt: 'desc' },
      take:                 100,
      include:              { items: { include: { product: true } } },
      relationLoadStrategy: 'query',
    }),

  revenue_by_city_and_category: async () => {
    const items = await prisma.cartItem.findMany({
      include: {
        product: { select: { category: true, price: true } },
        cart:    {
          select: {
            userId: true,
            user:   { select: { addresses: { select: { state: true, city: true } } } },
          },
        },
      },
      relationLoadStrategy: 'query',
    })

    const groups = new Map()
    for (const ci of items) {
      const category = ci.product.category
      const productPrice = num(ci.product.price)
      const lineRevenue = num(ci.quantity) * num(ci.unitPrice)
      const addrs = ci.cart.user.addresses
      if (!addrs.length) continue
      for (const a of addrs) {
        const key = `${a.state}${a.city}${category}`
        let g = groups.get(key)
        if (!g) {
          g = {
            state: a.state, city: a.city, category,
            revenue: 0, itemsSold: 0, uniqueBuyers: new Set(),
            priceSum: 0, priceCount: 0,
          }
          groups.set(key, g)
        }
        g.revenue       += lineRevenue
        g.itemsSold     += 1
        g.uniqueBuyers.add(ci.cart.userId)
        g.priceSum      += productPrice
        g.priceCount    += 1
      }
    }

    const rows = []
    for (const g of groups.values()) {
      rows.push({
        state:             g.state,
        city:              g.city,
        category:          g.category,
        revenue:           g.revenue,
        unique_buyers:     g.uniqueBuyers.size,
        items_sold:        g.itemsSold,
        avg_product_price: g.priceCount ? g.priceSum / g.priceCount : 0,
      })
    }
    rows.sort((a, b) => b.revenue - a.revenue)
    return rows.slice(0, 50)
  },

  frequently_bought_together: async ({ productId }) => {
    const targetItems = await prisma.cartItem.findMany({
      where:  { productId },
      select: { cartId: true },
    })
    const cartIds = targetItems.map((r) => r.cartId)
    if (!cartIds.length) return []

    const coItems = await prisma.cartItem.findMany({
      where:                { cartId: { in: cartIds }, productId: { not: productId } },
      include:              { product: { select: { id: true, name: true } } },
      relationLoadStrategy: 'query',
    })

    const counts = new Map()
    for (const ci of coItems) {
      let c = counts.get(ci.productId)
      if (!c) {
        c = { product_id: ci.productId, name: ci.product.name, co_occurrences: 0 }
        counts.set(ci.productId, c)
      }
      c.co_occurrences += 1
    }
    return Array.from(counts.values())
      .sort((a, b) =>
        (b.co_occurrences - a.co_occurrences) || (a.product_id - b.product_id))
      .slice(0, 10)
  },
}
