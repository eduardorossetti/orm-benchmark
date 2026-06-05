import { pgTable, serial, varchar, integer, timestamp, decimal } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', {
  id:        serial('id').primaryKey(),
  name:      varchar('name', { length: 100 }).notNull(),
  email:     varchar('email', { length: 150 }).notNull().unique(),
  city:      varchar('city', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
})

export const addresses = pgTable('addresses', {
  id:      serial('id').primaryKey(),
  userId:  integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  street:  varchar('street', { length: 200 }),
  city:    varchar('city', { length: 100 }),
  state:   varchar('state', { length: 50 }),
  zipCode: varchar('zip_code', { length: 20 }),
})

export const products = pgTable('products', {
  id:        serial('id').primaryKey(),
  name:      varchar('name', { length: 200 }).notNull(),
  category:  varchar('category', { length: 80 }),
  price:     decimal('price', { precision: 10, scale: 2 }).notNull(),
  stock:     integer('stock').default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

export const carts = pgTable('carts', {
  id:        serial('id').primaryKey(),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
})

export const cartItems = pgTable('cart_items', {
  id:        serial('id').primaryKey(),
  cartId:    integer('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity:  integer('quantity').notNull().default(1),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  carts:     many(carts),
}))

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}))

export const productsRelations = relations(products, ({ many }) => ({
  cartItems: many(cartItems),
}))

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user:  one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}))

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart:    one(carts,    { fields: [cartItems.cartId],    references: [carts.id]    }),
  product: one(products, { fields: [cartItems.productId], references: [products.id] }),
}))
