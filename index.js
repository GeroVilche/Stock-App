require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

async function verStock() {
  const resultado = await pool.query(`
    SELECT p.nombre,
           SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END) AS stock
    FROM productos p
    JOIN movimientos m ON m.producto_id = p.id
    GROUP BY p.nombre
    ORDER BY p.nombre;
  `);
  console.table(resultado.rows);
}

async function registrarVenta(productoId, cantidad) {
  await pool.query(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES ($1, 'venta', $2, 'Venta desde Node')`,
    [productoId, cantidad]
  );
  console.log(`Venta registrada: producto ${productoId}, cantidad ${cantidad}`);
}

async function main() {
  console.log('Stock antes:');
  await verStock();

  await registrarVenta(1, 2);

  console.log('Stock después:');
  await verStock();

  await pool.end();
}

main();