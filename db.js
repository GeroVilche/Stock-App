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

const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';

// Cada conexión usa la hora de Argentina, así "hoy" es hoy acá y no en el servidor.
pool.on('connect', (cliente) => {
  cliente.query("SELECT set_config('TimeZone', $1, false)", [ZONA_HORARIA]);
});

const CALCULO_STOCK = `COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END), 0)`;

// Todas las consultas reciben negocioId: cada negocio (y cada visitante de la demo) ve solo lo suyo.

async function obtenerNegocio(negocioId) {
  const resultado = await pool.query('SELECT nombre, ciudad FROM negocios WHERE id = $1', [negocioId]);
  return resultado.rows[0];
}

async function obtenerStock(negocioId) {
  const resultado = await pool.query(
    `SELECT p.id, p.nombre, p.categoria, p.precio_venta::float AS precio, p.stock_minimo,
            ${CALCULO_STOCK}::int AS stock
     FROM productos p
     LEFT JOIN movimientos m ON m.producto_id = p.id
     WHERE p.negocio_id = $1
     GROUP BY p.id
     ORDER BY p.nombre`,
    [negocioId]
  );
  return resultado.rows;
}

async function obtenerResumen(negocioId) {
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
    [negocioId]
  );
  return resultado.rows[0];
}

async function obtenerVentasPorDia(negocioId, dias) {
  const resultado = await pool.query(
    `SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia, COALESCE(SUM(m.cantidad), 0)::int AS unidades
     FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d(dia)
     LEFT JOIN movimientos m
       ON m.tipo = 'venta'
      AND m.fecha::date = d.dia::date
      AND m.producto_id IN (SELECT id FROM productos WHERE negocio_id = $1)
     GROUP BY d.dia
     ORDER BY d.dia`,
    [negocioId, dias]
  );
  return resultado.rows;
}

async function obtenerMovimientos(negocioId, limite) {
  const resultado = await pool.query(
    `SELECT m.id, to_char(m.fecha, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha,
            p.nombre, p.categoria, m.tipo, m.cantidad, m.nota
     FROM movimientos m
     JOIN productos p ON p.id = m.producto_id
     WHERE p.negocio_id = $1
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT $2`,
    [negocioId, limite]
  );
  return resultado.rows;
}

async function buscarProducto(negocioId, productoId) {
  const resultado = await pool.query(
    'SELECT nombre FROM productos WHERE id = $1 AND negocio_id = $2',
    [productoId, negocioId]
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

async function crearProducto(negocioId, nombre, categoria, precioVenta, stockMinimo) {
  const resultado = await pool.query(
    `INSERT INTO productos (negocio_id, nombre, categoria, precio_venta, stock_minimo)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [negocioId, nombre, categoria, precioVenta, stockMinimo]
  );
  return resultado.rows[0].id;
}

// ---------- Demo pública ----------

// Productos de la vinoteca de ejemplo: [nombre, categoría, costo, precio, mínimo, stock inicial]
const PRODUCTOS_DEMO = [
  ['Malbec Reserva 750ml', 'Tintos', 4500, 7900, 6, 30],
  ['Cabernet Sauvignon 750ml', 'Tintos', 4200, 7400, 6, 11],
  ['Bonarda Joven 750ml', 'Tintos', 2600, 4800, 8, 26],
  ['Pinot Noir Patagonia 750ml', 'Tintos', 7800, 13900, 4, 10],
  ['Torrontés Salta 750ml', 'Blancos', 3100, 5600, 6, 10],
  ['Chardonnay Barrica 750ml', 'Blancos', 5400, 9600, 4, 12],
  ['Rosado de Malbec 750ml', 'Rosados', 3300, 6200, 4, 11],
  ['Espumante Brut Nature', 'Espumantes', 5200, 9200, 5, 9],
];

// Generador de números "al azar" que siempre da la misma secuencia: así la demo se ve igual cada vez.
function azarConSemilla(semilla) {
  return () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Crea una vinoteca nueva solo para este visitante, con dos semanas de ventas inventadas.
async function crearNegocioDemo() {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const negocio = await cliente.query(
      `INSERT INTO negocios (nombre, ciudad, es_demo) VALUES ('Vinoteca de prueba', 'Tandil', true) RETURNING id`
    );
    const negocioId = negocio.rows[0].id;

    const azar = azarConSemilla(2026);
    const movimientos = []; // [productoId, tipo, cantidad, díasAtrás, horasAtrás, nota]

    const stock = [];
    for (const [nombre, categoria, costo, precio, minimo, inicial] of PRODUCTOS_DEMO) {
      const producto = await cliente.query(
        `INSERT INTO productos (negocio_id, nombre, categoria, precio_costo, precio_venta, stock_minimo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [negocioId, nombre, categoria, costo, precio, minimo]
      );
      const id = producto.rows[0].id;
      stock.push({ id, cantidad: inicial });
      movimientos.push([id, 'entrada', inicial, 15, 3, 'Stock inicial']);
    }

    // Ventas de los últimos 14 días (el día 0 es hoy).
    for (let dias = 13; dias >= 0; dias -= 1) {
      const ventasDelDia = 1 + Math.floor(azar() * 4);
      for (let v = 0; v < ventasDelDia; v += 1) {
        const producto = stock[Math.floor(azar() * stock.length)];
        const cantidad = 1 + Math.floor(azar() * 2);
        if (producto.cantidad - cantidad < 1) continue;
        producto.cantidad -= cantidad;
        const horasAtras = dias === 0 ? 1 + v : 2 + Math.floor(azar() * 8);
        movimientos.push([producto.id, 'venta', cantidad, dias, horasAtras, 'Venta en el local']);
      }
    }

    movimientos.push([stock[0].id, 'entrada', 12, 4, 5, 'Llegó el pedido del proveedor']);
    movimientos.push([stock[4].id, 'ajuste', -1, 2, 6, 'Botella rota']);

    const valores = [];
    const parametros = [];
    movimientos.forEach(([productoId, tipo, cantidad, dias, horas, nota], i) => {
      const n = i * 6;
      valores.push(`($${n + 1}, $${n + 2}, $${n + 3}, NOW() - make_interval(days => $${n + 4}, hours => $${n + 5}), $${n + 6})`);
      parametros.push(productoId, tipo, cantidad, dias, horas, nota);
    });
    await cliente.query(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, fecha, nota) VALUES ${valores.join(', ')}`,
      parametros
    );

    await cliente.query('COMMIT');
    return negocioId;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

// Borra una vinoteca de demo con todo lo que tiene. Solo borra negocios marcados como demo.
async function borrarNegocioDemo(negocioId) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const esDemo = await cliente.query('SELECT 1 FROM negocios WHERE id = $1 AND es_demo', [negocioId]);
    if (esDemo.rowCount === 1) {
      await cliente.query(
        'DELETE FROM movimientos WHERE producto_id IN (SELECT id FROM productos WHERE negocio_id = $1)',
        [negocioId]
      );
      await cliente.query('DELETE FROM productos WHERE negocio_id = $1', [negocioId]);
      await cliente.query('DELETE FROM negocios WHERE id = $1', [negocioId]);
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

// Limpieza: borra las demos que tienen más de unas horas (por si alguien cerró la pestaña sin salir).
async function borrarDemosViejas(horas) {
  const viejas = await pool.query(
    `SELECT id FROM negocios WHERE es_demo AND creado < NOW() - make_interval(hours => $1)`,
    [horas]
  );
  for (const { id } of viejas.rows) await borrarNegocioDemo(id);
  return viejas.rows.length;
}

module.exports = {
  pool, obtenerNegocio, obtenerStock, obtenerResumen, obtenerVentasPorDia, obtenerMovimientos,
  buscarProducto, stockDe, registrarVenta, registrarEntrada, crearProducto,
  crearNegocioDemo, borrarNegocioDemo, borrarDemosViejas,
};
