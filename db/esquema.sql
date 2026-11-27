-- Tablas del sistema de stock y datos de ejemplo de una vinoteca.
-- Se corre una sola vez sobre una base vacía (en pgAdmin o en el SQL Editor de Neon).

CREATE TABLE negocios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  ciudad VARCHAR(60)
);

CREATE TABLE productos (
  id SERIAL PRIMARY KEY,
  negocio_id INT NOT NULL REFERENCES negocios(id),
  nombre VARCHAR(120) NOT NULL,
  categoria VARCHAR(60),
  precio_costo NUMERIC(12,2),
  precio_venta NUMERIC(12,2) NOT NULL,
  stock_minimo INT NOT NULL DEFAULT 0
);

-- El stock no se guarda: se calcula sumando las entradas y restando las ventas.
CREATE TABLE movimientos (
  id SERIAL PRIMARY KEY,
  producto_id INT NOT NULL REFERENCES productos(id),
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada', 'venta', 'ajuste')),
  cantidad INT NOT NULL CHECK (cantidad <> 0),
  fecha TIMESTAMP NOT NULL DEFAULT NOW(),
  nota TEXT
);

-- Datos de ejemplo
INSERT INTO negocios (nombre, ciudad) VALUES ('Vinoteca de prueba', 'Tandil');

INSERT INTO productos (negocio_id, nombre, categoria, precio_costo, precio_venta, stock_minimo) VALUES
  (1, 'Malbec Reserva 750ml', 'Tintos', 4500, 7900, 6),
  (1, 'Cabernet Sauvignon 750ml', 'Tintos', 4200, 7400, 6),
  (1, 'Torrontés 750ml', 'Blancos', 3100, 5600, 4),
  (1, 'Espumante Brut', 'Espumantes', 5200, 9200, 3);

INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES
  (1, 'entrada', 20, 'Stock inicial'),
  (2, 'entrada', 10, 'Stock inicial'),
  (3, 'entrada', 12, 'Stock inicial'),
  (4, 'entrada', 4, 'Stock inicial'),
  (1, 'venta', 3, 'Venta de prueba'),
  (4, 'venta', 2, 'Venta de prueba');
