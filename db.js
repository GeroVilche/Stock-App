require('dotenv').config();
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });

// Por ahora el sistema trabaja con un solo negocio (el de id 1).
const NEGOCIO_ID = Number(process.env.NEGOCIO_ID || 1);
const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';

// Cada conexión usa la hora de Argentina, así "hoy" es hoy acá y no en el servidor.
pool.on('connect', (cliente) => {
  cliente.query("SELECT set_config('TimeZone', $1, false)", [ZONA_HORARIA]);
});

const CALCULO_STOCK = `COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END), 0)`;

async function obtenerNegocio() {
  const resultado = await pool.query('SELECT nombre, ciudad FROM negocios WHERE id = $1', [NEGOCIO_ID]);
  return resultado.rows[0];
}

async function obtenerStock() {
  const resultado = await pool.query(
    `SELECT p.id, p.nombre, p.categoria, p.precio_venta::float AS precio, p.stock_minimo,
            ${CALCULO_STOCK}::int AS stock
     FROM productos p
     LEFT JOIN movimientos m ON m.producto_id = p.id
     WHERE p.negocio_id = $1
     GROUP BY p.id
     ORDER BY p.nombre`,
    [NEGOCIO_ID]
  );
  return resultado.rows;
}

async function obtenerResumen() {
  const resultado = await pool.query(
    `WITH stock AS (
       SELECT p.id, p.precio_venta, p.stock_minimo, ${CALCULO_STOCK} AS stock
       FROM productos p
       LEFT JOIN movimientos m ON m.producto_id = p.id
       WHERE p.negocio_id = $1
       GROUP BY p.id
     ),
     hoy AS (
       SELECT COALESCE(SUM(m.cantidad), 0) AS unidades,
              COALESCE(SUM(m.cantidad * p.precio_venta), 0) AS pesos
       FROM movimientos m
       JOIN productos p ON p.id = m.producto_id
       WHERE p.negocio_id = $1 AND m.tipo = 'venta' AND m.fecha::date = CURRENT_DATE
     )
     SELECT COALESCE(SUM(stock * precio_venta), 0)::float AS valor_stock,
            COALESCE(SUM(stock), 0)::int AS unidades,
            COUNT(*)::int AS productos,
            (COUNT(*) FILTER (WHERE stock < stock_minimo))::int AS para_reponer,
            (SELECT unidades FROM hoy)::int AS vendido_hoy,
            (SELECT pesos FROM hoy)::float AS ingresos_hoy
     FROM stock`,
    [NEGOCIO_ID]
  );
  return resultado.rows[0];
}

async function obtenerVentasPorDia(dias) {
  const resultado = await pool.query(
    `SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia, COALESCE(SUM(m.cantidad), 0)::int AS unidades
     FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d(dia)
     LEFT JOIN movimientos m
       ON m.tipo = 'venta'
      AND m.fecha::date = d.dia::date
      AND m.producto_id IN (SELECT id FROM productos WHERE negocio_id = $1)
     GROUP BY d.dia
     ORDER BY d.dia`,
    [NEGOCIO_ID, dias]
  );
  return resultado.rows;
}

async function obtenerMovimientos(limite) {
  const resultado = await pool.query(
    `SELECT m.id, to_char(m.fecha, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha,
            p.nombre, p.categoria, m.tipo, m.cantidad, m.nota
     FROM movimientos m
     JOIN productos p ON p.id = m.producto_id
     WHERE p.negocio_id = $1
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT $2`,
    [NEGOCIO_ID, limite]
  );
  return resultado.rows;
}

async function buscarProducto(productoId) {
  const resultado = await pool.query(
    'SELECT nombre FROM productos WHERE id = $1 AND negocio_id = $2',
    [productoId, NEGOCIO_ID]
  );
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
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [NEGOCIO_ID, nombre, categoria, precioVenta, stockMinimo]
  );
  return resultado.rows[0].id;
}

module.exports = {
  pool, obtenerNegocio, obtenerStock, obtenerResumen, obtenerVentasPorDia, obtenerMovimientos,
  buscarProducto, stockDe, registrarVenta, registrarEntrada, crearProducto,
};
