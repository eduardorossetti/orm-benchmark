CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE users (
  id         SERIAL       PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) UNIQUE NOT NULL,
  city       VARCHAR(100),
  created_at TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE addresses (
  id       SERIAL       PRIMARY KEY,
  user_id  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  street   VARCHAR(200),
  city     VARCHAR(100),
  state    VARCHAR(50),
  zip_code VARCHAR(20)
);

CREATE TABLE products (
  id         SERIAL         PRIMARY KEY,
  name       VARCHAR(200)   NOT NULL,
  category   VARCHAR(80),
  price      NUMERIC(10, 2) NOT NULL,
  stock      INTEGER        DEFAULT 0,
  created_at TIMESTAMP      DEFAULT NOW()
);

CREATE TABLE carts (
  id         SERIAL    PRIMARY KEY,
  user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE cart_items (
  id         SERIAL         PRIMARY KEY,
  cart_id    INTEGER        NOT NULL REFERENCES carts(id)    ON DELETE CASCADE,
  product_id INTEGER        NOT NULL REFERENCES products(id),
  quantity   INTEGER        NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL
);

CREATE INDEX idx_addresses_user_id  ON addresses(user_id);
CREATE INDEX idx_carts_user_id      ON carts(user_id);
CREATE INDEX idx_carts_created_at   ON carts(created_at);
CREATE INDEX idx_cart_items_cart    ON cart_items(cart_id);
CREATE INDEX idx_cart_items_product ON cart_items(product_id);
CREATE INDEX idx_users_city         ON users(city);
CREATE INDEX idx_products_category  ON products(category);
