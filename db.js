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
    SELECT p.id, p.nombre,
           SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END)::int AS stock
    FROM productos p
    JOIN movimientos m ON m.producto_id = p.id
    GROUP BY p.id, p.nombre
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
    `INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES ($1, 'venta', $2, 'Venta desde el servidor')`,
    [productoId, cantidad]
  );
}

async function registrarEntrada(productoId, cantidad) {
  await pool.query(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES ($1, 'entrada', $2, 'Entrada desde la página')`,
    [productoId, cantidad]
  );
}

module.exports = { pool, obtenerStock, buscarProducto, stockDe, registrarVenta, registrarEntrada };