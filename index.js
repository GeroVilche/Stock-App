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
    SELECT p.id, p.nombre,
           SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END) AS stock
    FROM productos p
    JOIN movimientos m ON m.producto_id = p.id
    GROUP BY p.id, p.nombre
    ORDER BY p.id;
  `);
  console.table(resultado.rows);
}

async function buscarProducto(productoId) {
  const resultado = await pool.query('SELECT nombre FROM productos WHERE id = $1', [productoId]);
  return resultado.rows[0];
}

async function stockDe(productoId) {
  const resultado = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'venta' THEN -cantidad ELSE cantidad END), 0) AS stock
     FROM movimientos WHERE producto_id = $1`,
    [productoId]
  );
  return Number(resultado.rows[0].stock);
}

async function registrarVenta(productoId, cantidad) {
  await pool.query(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, nota) VALUES ($1, 'venta', $2, 'Venta desde Node')`,
    [productoId, cantidad]
  );
}

async function main() {
  const productoId = Number(process.argv[2]);
  const cantidad = Number(process.argv[3]);

  if (!process.argv[2]) {
    await verStock();
    return;
  }

  if (!Number.isInteger(productoId) || !Number.isInteger(cantidad) || cantidad <= 0) {
    console.log('Uso: node index.js <id del producto> <cantidad>   (ej: node index.js 4 1)');
    return;
  }

  const producto = await buscarProducto(productoId);
  if (!producto) {
    console.log(`No existe un producto con id ${productoId}.`);
    return;
  }

  const disponible = await stockDe(productoId);
  if (cantidad > disponible) {
    console.log(`No hay stock suficiente de ${producto.nombre}: querés vender ${cantidad} y hay ${disponible}.`);
    return;
  }

  await registrarVenta(productoId, cantidad);
  console.log(`Venta registrada: ${cantidad} x ${producto.nombre}. Quedan ${disponible - cantidad}.`);
  await verStock();
}

main().finally(() => pool.end());