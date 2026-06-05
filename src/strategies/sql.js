import pool from '../db/sql.js'

const q = async (text, params) => (await pool.query(text, params)).rows

export const sqlStrategy = {
  name: 'sql',
  cleanup: () => pool.end(),

  select_by_id: ({ userId }) =>
    q('SELECT id, name, email, city FROM users WHERE id = $1', [userId]),

  cart_detail: ({ cartId }) =>
    q(`
      SELECT ci.id, ci.quantity, ci.unit_price,
             p.id AS product_id, p.name AS product_name, p.price
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1
    `, [cartId]),

  n_plus_one: async ({ cartIds }) => {
    const results = []
    for (const cartId of cartIds) {
      const items = await q(`
        SELECT id, cart_id, product_id, quantity, unit_price
        FROM cart_items
        WHERE cart_id = $1
      `, [cartId])
      results.push(...items)
    }
    return results
  },

  eager_join: ({ cartIds }) =>
    q(`
      SELECT
        c.id AS cart_id,
        ci.id AS item_id,
        ci.quantity,
        ci.unit_price,
        p.id   AS product_id,
        p.name AS product_name
      FROM carts c
      LEFT JOIN cart_items ci ON ci.cart_id = c.id
      LEFT JOIN products   p  ON p.id       = ci.product_id
      WHERE c.id = ANY($1)
    `, [cartIds]),

  revenue_by_city_and_category: () =>
    q(`
      SELECT a.state, a.city, p.category,
             SUM(ci.quantity * ci.unit_price) AS revenue,
             COUNT(DISTINCT u.id)             AS unique_buyers,
             COUNT(*)                         AS items_sold,
             AVG(p.price)                     AS avg_product_price
      FROM users u
      JOIN addresses  a  ON a.user_id    = u.id
      JOIN carts      c  ON c.user_id    = u.id
      JOIN cart_items ci ON ci.cart_id   = c.id
      JOIN products   p  ON p.id         = ci.product_id
      GROUP BY a.state, a.city, p.category
      ORDER BY revenue DESC
      LIMIT 50
    `),

  recent_carts_7d: ({ since }) =>
    q(`
      WITH recent_carts AS (
        SELECT id, created_at FROM carts
        WHERE created_at >= $1
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      )
      SELECT rc.id AS cart_id, rc.created_at,
             ci.id AS item_id, ci.quantity, ci.unit_price,
             p.id AS product_id, p.name AS product_name, p.category
      FROM recent_carts rc
      JOIN cart_items ci ON ci.cart_id = rc.id
      JOIN products   p  ON p.id        = ci.product_id
      ORDER BY rc.created_at DESC, rc.id DESC, ci.id ASC
    `, [since]),

  frequently_bought_together: ({ productId }) =>
    q(`
      SELECT ci2.product_id, p2.name,
             COUNT(*) AS co_occurrences
      FROM cart_items ci1
      JOIN cart_items ci2 ON ci2.cart_id = ci1.cart_id AND ci2.product_id <> ci1.product_id
      JOIN products   p2  ON p2.id        = ci2.product_id
      WHERE ci1.product_id = $1
      GROUP BY ci2.product_id, p2.name
      ORDER BY co_occurrences DESC, ci2.product_id ASC
      LIMIT 10
    `, [productId]),

  products_never_sold: () =>
    q(`
      SELECT p.id, p.name, p.price, p.stock
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM cart_items ci WHERE ci.product_id = p.id
      )
    `),

  browse_catalog_paginated: ({ offset }) =>
    q(`
      WITH top_sold AS (
        SELECT product_id, SUM(quantity) AS units_sold
        FROM cart_items
        GROUP BY product_id
        ORDER BY units_sold DESC, product_id ASC
        LIMIT 20 OFFSET $1
      )
      SELECT p.id, p.name, p.price, p.stock, ts.units_sold
      FROM top_sold ts
      JOIN products p ON p.id = ts.product_id
      ORDER BY ts.units_sold DESC, p.id ASC
    `, [offset]),

  users_above_avg_spending: () =>
    q(`
      SELECT u.id, u.name,
             SUM(ci.quantity * ci.unit_price) AS spent
      FROM users u
      JOIN carts      c  ON c.user_id  = u.id
      JOIN cart_items ci ON ci.cart_id = c.id
      GROUP BY u.id, u.name
      HAVING SUM(ci.quantity * ci.unit_price) > (
        SELECT AVG(s.spent) FROM (
          SELECT SUM(ci.quantity * ci.unit_price) AS spent
          FROM cart_items ci
          JOIN carts c ON c.id = ci.cart_id
          GROUP BY c.user_id
        ) s
      )
      ORDER BY spent DESC
      LIMIT 50
    `),
}
