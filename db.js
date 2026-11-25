require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

async function obtenerStock() {
  const resultado = await pool.query(`
    SELECT p.id, p.nombre, p.stock_minimo,
           COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END), 0)::int AS stock
    FROM productos p
    LEFT JOIN movimientos m ON m.producto_id = p.id
    GROUP BY p.id, p.nombre, p.stock_minimo
    ORDER BY p.id;
  `);
  return resultado.rows;
}

async function buscarProducto(productoId) {
  const resultado = await pool.query('SELECT nombre FROM productos WHERE id = $1', [productoId]);
  return resultado.rows[0];
}

async function stockDe(productoId) {
  const resultado = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'venta' THEN -cantidad ELSE cantidad END), 0)::int AS stock
     FROM movimientos WHERE producto_id = $1`,
    [productoId]
  );
  return resultado.rows[0].stock;
}

async function registrarVenta(productoId, cantidad) {
  await pool.query(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES ($1, 'venta', $2, 'Venta desde la página')`,
    [productoId, cantidad]
  );
}

async function registrarEntrada(productoId, cantidad) {
  await pool.query(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES ($1, 'entrada', $2, 'Entrada desde la página')`,
    [productoId, cantidad]
  );
}

async function crearProducto(nombre, categoria, precioVenta, stockMinimo) {
  const resultado = await pool.query(
    `INSERT INTO productos (negocio_id, nombre, categoria, precio_venta, stock_minimo)
     VALUES (1, $1, $2, $3, $4) RETURNING id`,
    [nombre, categoria, precioVenta, stockMinimo]
  );
  return resultado.rows[0].id;
}

async function obtenerMovimientos(limite = 15) {
  const resultado = await pool.query(
    `SELECT m.id, m.fecha, p.nombre, m.tipo, m.cantidad, m.nota
     FROM movimientos m
     JOIN productos p ON p.id = m.producto_id
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT $1`,
    [limite]
  );
  return resultado.rows;
}

module.exports = { pool, obtenerStock, buscarProducto, stockDe, registrarVenta, registrarEntrada, crearProducto, obtenerMovimientos };