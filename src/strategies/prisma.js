import prisma from '../db/prisma.js'

const num = (d) => (d == null ? 0 : Number(d))

export const prismaStrategy = {
  name: 'prisma',
  cleanup: () => prisma.$disconnect(),

  select_by_id: ({ userId }) =>
    prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, name: true, email: true, city: true },
    }),

  cart_detail: ({ cartId }) =>
    prisma.cartItem.findMany({
      where:   { cartId },
      include: { product: true },
    }),

  n_plus_one: async ({ cartIds }) => {
    const results = []
    for (const cartId of cartIds) {
      const items = await prisma.cartItem.findMany({ where: { cartId } })
      results.push(...items)
    }
    return results
  },

  eager_join: ({ cartIds }) =>
    prisma.cart.findMany({
      where:   { id: { in: cartIds } },
      include: { items: { include: { product: true } } },
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

  recent_carts_7d: ({ since }) =>
    prisma.cart.findMany({
      where:   { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take:    100,
      include: { items: { include: { product: true } } },
    }),

  frequently_bought_together: async ({ productId }) => {
    const targetItems = await prisma.cartItem.findMany({
      where:  { productId },
      select: { cartId: true },
    })
    const cartIds = targetItems.map((r) => r.cartId)
    if (!cartIds.length) return []

    const coItems = await prisma.cartItem.findMany({
      where:   { cartId: { in: cartIds }, productId: { not: productId } },
      include: { product: { select: { id: true, name: true } } },
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

  products_never_sold: () =>
    prisma.product.findMany({
      where:  { cartItems: { none: {} } },
      select: { id: true, name: true, price: true, stock: true },
    }),

  browse_catalog_paginated: async ({ offset }) => {
    const grouped = await prisma.cartItem.groupBy({
      by:      ['productId'],
      _sum:    { quantity: true },
      orderBy: [{ _sum: { quantity: 'desc' } }, { productId: 'asc' }],
      take:    20,
      skip:    offset,
    })
    if (!grouped.length) return []

    const productIds = grouped.map((g) => g.productId)
    const products = await prisma.product.findMany({
      where:  { id: { in: productIds } },
      select: { id: true, name: true, price: true, stock: true },
    })
    const byId = new Map(products.map((p) => [p.id, p]))

    return grouped.map((g) => {
      const p = byId.get(g.productId)
      return {
        id:         p.id,
        name:       p.name,
        price:      p.price,
        stock:      p.stock,
        units_sold: num(g._sum.quantity),
      }
    })
  },

  users_above_avg_spending: async () => {
    const items = await prisma.cartItem.findMany({
      select: {
        quantity:  true,
        unitPrice: true,
        cart:      { select: { userId: true } },
      },
    })

    const spentByUser = new Map()
    for (const ci of items) {
      const userId = ci.cart.userId
      const line   = num(ci.quantity) * num(ci.unitPrice)
      spentByUser.set(userId, (spentByUser.get(userId) || 0) + line)
    }
    if (!spentByUser.size) return []

    let sum = 0
    for (const v of spentByUser.values()) sum += v
    const avg = sum / spentByUser.size

    const above = []
    for (const [userId, spent] of spentByUser) {
      if (spent > avg) above.push({ userId, spent })
    }
    above.sort((a, b) => b.spent - a.spent)
    const top = above.slice(0, 50)
    if (!top.length) return []

    const users = await prisma.user.findMany({
      where:  { id: { in: top.map((r) => r.userId) } },
      select: { id: true, name: true },
    })
    const nameById = new Map(users.map((u) => [u.id, u.name]))
    return top.map((r) => ({ id: r.userId, name: nameById.get(r.userId), spent: r.spent }))
  },
}
