import { faker } from '@faker-js/faker'

const rand = (min, max) => faker.number.int({ min, max })

const USER_MAX    = 10_000
const PRODUCT_MAX =  1_000
const CART_MAX    = 10_000

export function seedScenarioParams(scenarioId) {
  let h = 2166136261
  for (let i = 0; i < scenarioId.length; i++) {
    h = Math.imul(h ^ scenarioId.charCodeAt(i), 16777619)
  }
  faker.seed(h >>> 0)
}

export const scenarios = {
  select_by_id: {
    name: 'SELECT user por ID (PK indexada)',
    category: 'simple',
    nextParams: () => ({ userId: rand(1, USER_MAX) }),
  },

  cart_detail: {
    name: 'SELECT items de 1 cart + JOIN products (1 nível, sem agregação)',
    category: 'simple',
    nextParams: () => ({ cartId: rand(1, CART_MAX) }),
  },

  n_plus_one: {
    name: 'N+1: 100 carts → buscar items 1 por 1',
    category: 'pathological',
    nextParams: () => ({
      cartIds: Array.from({ length: 100 }, () => rand(1, CART_MAX)),
    }),
  },

  eager_join: {
    name: 'Eager: 100 carts + items em 1 query (IN/JOIN)',
    category: 'pathological',
    nextParams: () => ({
      cartIds: Array.from({ length: 100 }, () => rand(1, CART_MAX)),
    }),
  },

  revenue_by_city_and_category: {
    name: 'Faturamento por cidade × categoria (5 tabelas, GROUP BY 3 cols, pivot 2D)',
    category: 'analytical',
    nextParams: () => ({}),
  },

  recent_carts_7d: {
    name: 'Carts dos últimos 7 dias com items + produtos (range scan em índice timestamp)',
    category: 'analytical',
    nextParams: () => ({
      since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    }),
  },

  frequently_bought_together: {
    name: 'Produtos co-comprados (SELF-JOIN + GROUP BY)',
    category: 'analytical',
    nextParams: () => ({ productId: rand(1, PRODUCT_MAX) }),
  },

  products_never_sold: {
    name: 'Produtos nunca vendidos (NOT EXISTS correlacionado)',
    category: 'analytical',
    nextParams: () => ({}),
  },

  browse_catalog_paginated: {
    name: 'Catálogo paginado por popularidade (LEFT JOIN + GROUP BY + LIMIT/OFFSET)',
    category: 'analytical',
    nextParams: () => ({
      offset: rand(0, 49) * 20,
    }),
  },

  users_above_avg_spending: {
    name: 'Usuários acima da média de gasto (HAVING + subquery escalar)',
    category: 'analytical',
    nextParams: () => ({}),
  },
}
