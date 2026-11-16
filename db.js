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

module.exports = { pool, obtenerStock };