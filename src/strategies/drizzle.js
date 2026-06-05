import {
  and,
  asc,
  avg,
  count,
  countDistinct,
  desc,
  eq,
  gt, gte, inArray,
  ne,
  notExists, sql as sqlTag,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  addresses,
  cartItems,
  carts,
  products as productsTable,
  users,
} from '../db/drizzle-schema.js'
import { closeDb, db } from '../db/drizzle.js'

const ci2 = alias(cartItems, 'ci2')

export const drizzleStrategy = {
  name: 'drizzle',
  cleanup: closeDb,

  select_by_id: ({ userId }) =>
    db.select({
      id:    users.id,
      name:  users.name,
      email: users.email,
      city:  users.city,
    }).from(users).where(eq(users.id, userId)),

  cart_detail: ({ cartId }) =>
    db
      .select({
        id:           cartItems.id,
        quantity:     cartItems.quantity,
        unitPrice:    cartItems.unitPrice,
        productId:    productsTable.id,
        productName:  productsTable.name,
        price:        productsTable.price,
      })
      .from(cartItems)
      .innerJoin(productsTable, eq(productsTable.id, cartItems.productId))
      .where(eq(cartItems.cartId, cartId)),

  n_plus_one: async ({ cartIds }) => {
    const results = []
    for (const cartId of cartIds) {
      const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId))
      results.push(...items)
    }
    return results
  },

  eager_join: ({ cartIds }) =>
    db.select()
      .from(carts)
      .leftJoin(cartItems,     eq(cartItems.cartId, carts.id))
      .leftJoin(productsTable, eq(productsTable.id, cartItems.productId))
      .where(inArray(carts.id, cartIds)),

  revenue_by_city_and_category: () =>
    db
      .select({
        state:           addresses.state,
        city:            addresses.city,
        category:        productsTable.category,
        revenue:         sqlTag`SUM(${cartItems.quantity} * ${cartItems.unitPrice})`.as('revenue'),
        uniqueBuyers:    countDistinct(users.id).as('unique_buyers'),
        itemsSold:       count().as('items_sold'),
        avgProductPrice: avg(productsTable.price).as('avg_product_price'),
      })
      .from(users)
      .innerJoin(addresses,     eq(addresses.userId,   users.id))
      .innerJoin(carts,         eq(carts.userId,       users.id))
      .innerJoin(cartItems,     eq(cartItems.cartId,   carts.id))
      .innerJoin(productsTable, eq(productsTable.id,   cartItems.productId))
      .groupBy(addresses.state, addresses.city, productsTable.category)
      .orderBy(sqlTag`revenue DESC`)
      .limit(50),

  recent_carts_7d: ({ since }) => {
    const recentCarts = db
      .select({ id: carts.id, createdAt: carts.createdAt })
      .from(carts)
      .where(gte(carts.createdAt, since))
      .orderBy(desc(carts.createdAt), desc(carts.id))
      .limit(100)
      .as('recent_carts')

    return db
      .select({
        cartId:      recentCarts.id,
        createdAt:   recentCarts.createdAt,
        itemId:      cartItems.id,
        quantity:    cartItems.quantity,
        unitPrice:   cartItems.unitPrice,
        productId:   productsTable.id,
        productName: productsTable.name,
        category:    productsTable.category,
      })
      .from(recentCarts)
      .innerJoin(cartItems,     eq(cartItems.cartId, recentCarts.id))
      .innerJoin(productsTable, eq(productsTable.id, cartItems.productId))
      .orderBy(desc(recentCarts.createdAt), desc(recentCarts.id), asc(cartItems.id))
  },

  frequently_bought_together: ({ productId }) =>
    db
      .select({
        productId:     ci2.productId,
        name:          productsTable.name,
        coOccurrences: count().as('co_occurrences'),
      })
      .from(cartItems)
      .innerJoin(ci2, and(eq(ci2.cartId, cartItems.cartId), ne(ci2.productId, cartItems.productId)))
      .innerJoin(productsTable, eq(productsTable.id, ci2.productId))
      .where(eq(cartItems.productId, productId))
      .groupBy(ci2.productId, productsTable.name)
      .orderBy(sqlTag`co_occurrences DESC`, asc(ci2.productId))
      .limit(10),

  products_never_sold: () =>
    db
      .select({
        id:    productsTable.id,
        name:  productsTable.name,
        price: productsTable.price,
        stock: productsTable.stock,
      })
      .from(productsTable)
      .where(notExists(
        db.select().from(cartItems).where(eq(cartItems.productId, productsTable.id))
      )),

  browse_catalog_paginated: ({ offset }) => {
    const topSold = db
      .select({
        productId: cartItems.productId,
        unitsSold: sqlTag`SUM(${cartItems.quantity})`.as('units_sold'),
      })
      .from(cartItems)
      .groupBy(cartItems.productId)
      .orderBy(sqlTag`units_sold DESC`, asc(cartItems.productId))
      .limit(20)
      .offset(offset)
      .as('top_sold')

    return db
      .select({
        id:        productsTable.id,
        name:      productsTable.name,
        price:     productsTable.price,
        stock:     productsTable.stock,
        unitsSold: topSold.unitsSold,
      })
      .from(topSold)
      .innerJoin(productsTable, eq(productsTable.id, topSold.productId))
      .orderBy(desc(topSold.unitsSold), asc(productsTable.id))
  },

  users_above_avg_spending: () => {
    const userSpent = db
      .select({
        userId: carts.userId,
        spent:  sqlTag`SUM(${cartItems.quantity} * ${cartItems.unitPrice})`.as('spent'),
      })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .groupBy(carts.userId)
      .as('user_spent')

    const avgSpent = db.select({ avg: avg(userSpent.spent) }).from(userSpent)

    return db
      .select({
        id:    users.id,
        name:  users.name,
        spent: sqlTag`SUM(${cartItems.quantity} * ${cartItems.unitPrice})`.as('spent'),
      })
      .from(users)
      .innerJoin(carts,     eq(carts.userId,     users.id))
      .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
      .groupBy(users.id, users.name)
      .having(gt(sqlTag`SUM(${cartItems.quantity} * ${cartItems.unitPrice})`, avgSpent))
      .orderBy(desc(sqlTag`spent`))
      .limit(50)
  },
}
