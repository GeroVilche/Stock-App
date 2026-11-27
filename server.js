const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const {
  obtenerNegocio, obtenerStock, obtenerResumen, obtenerVentasPorDia, obtenerMovimientos,
  buscarProducto, stockDe, registrarVenta, registrarEntrada, crearProducto,
  crearNegocioDemo, borrarNegocioDemo, borrarDemosViejas,
} = require('./db');

const app = express();
const PUERTO = process.env.PORT || 3000;
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000;
const DURACION_DEMO_MS = 2 * 60 * 60 * 1000;
const NEGOCIO_PRINCIPAL = Number(process.env.NEGOCIO_ID || 1);

if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  console.error('Faltan ADMIN_USER, ADMIN_PASSWORD o SESSION_SECRET en las variables de entorno');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(express.json());

// ---------- Sesiones ----------

function firmar(texto) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(texto).digest('base64url');
}

function iguales(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// La "pulsera de entrada": quién es, qué negocio ve, si es demo y hasta cuándo vale.
function crearToken(sesion, duracionMs) {
  const datos = Buffer.from(JSON.stringify({ ...sesion, vence: Date.now() + duracionMs })).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}

function guardarSesion(req, res, sesion, duracionMs) {
  res.cookie('sesion', crearToken(sesion, duracionMs), {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: duracionMs,
  });
}

// Devuelve los datos de la sesión si el token es válido, o null si no.
function leerSesion(token) {
  if (!token) return null;
  const [datos, firma] = token.split('.');
  if (!datos || !firma || !iguales(firma, firmar(datos))) return null;
  try {
    const sesion = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return Date.now() < sesion.vence ? sesion : null;
  } catch {
    return null;
  }
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [clave, ...resto] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(resto.join('='));
  }
  return null;
}

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Demasiados intentos. Probá de nuevo en 15 minutos.' },
});

// Cada demo crea datos en la base: limitamos cuántas puede abrir una misma persona.
const limiteDemo = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  message: { error: 'Abriste muchas demos seguidas. Probá de nuevo en un rato.' },
});

// ---------- Rutas públicas (no piden login) ----------

app.get('/login', (req, res) => {
  if (leerSesion(leerCookie(req, 'sesion'))) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

app.post('/login', limiteLogin, (req, res) => {
  const { usuario, clave } = req.body;
  if (!iguales(usuario, process.env.ADMIN_USER) || !iguales(clave, process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  guardarSesion(req, res, { usuario, negocioId: NEGOCIO_PRINCIPAL, demo: false }, DURACION_SESION_MS);
  res.json({ ok: true });
});

// Demo pública: cada visitante recibe su propia vinoteca de prueba, que se borra al salir.
app.post('/demo', limiteDemo, async (req, res) => {
  try {
    const negocioId = await crearNegocioDemo();
    guardarSesion(req, res, { usuario: 'Visitante', negocioId, demo: true }, DURACION_DEMO_MS);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo abrir la demo. Probá de nuevo en unos segundos.' });
  }
});

app.post('/logout', async (req, res) => {
  const sesion = leerSesion(leerCookie(req, 'sesion'));
  if (sesion?.demo) {
    await borrarNegocioDemo(sesion.negocioId).catch((error) => console.error(error));
  }
  res.clearCookie('sesion');
  res.json({ ok: true });
});

// ---------- De acá para abajo, todo pide login ----------

function requerirLogin(req, res, next) {
  const sesion = leerSesion(leerCookie(req, 'sesion'));
  if (sesion) {
    req.usuario = sesion.usuario;
    req.demo = Boolean(sesion.demo);
    req.negocioId = sesion.negocioId ?? NEGOCIO_PRINCIPAL;
    return next();
  }
  if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
    return res.redirect('/login');
  }
  res.status(401).json({ error: 'Tenés que iniciar sesión' });
}

app.use(requerirLogin);
app.use(express.static('public'));

function datosValidos(productoId, cantidad) {
  return Number.isInteger(productoId) && Number.isInteger(cantidad) && cantidad > 0;
}

// Convierte un parámetro de la URL en un número entero dentro de un rango.
function entreLimites(valor, minimo, maximo, porDefecto) {
  const numero = Number.parseInt(valor, 10);
  if (Number.isNaN(numero)) return porDefecto;
  return Math.min(Math.max(numero, minimo), maximo);
}

// Envuelve una ruta para que cualquier error responda 500 con un mensaje claro.
function ruta(mensajeError, manejador) {
  return async (req, res) => {
    try {
      await manejador(req, res);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: mensajeError });
    }
  };
}

app.get('/negocio', ruta('No se pudo obtener el negocio', async (req, res) => {
  const negocio = await obtenerNegocio(req.negocioId);
  res.json({
    nombre: negocio?.nombre || 'Mi negocio',
    ciudad: negocio?.ciudad || '',
    usuario: req.usuario,
    demo: req.demo,
  });
}));

app.get('/stock', ruta('No se pudo obtener el stock', async (req, res) => {
  res.json(await obtenerStock(req.negocioId));
}));

app.get('/resumen', ruta('No se pudo obtener el resumen', async (req, res) => {
  res.json(await obtenerResumen(req.negocioId));
}));

app.get('/ventas-por-dia', ruta('No se pudieron obtener las ventas por día', async (req, res) => {
  res.json(await obtenerVentasPorDia(req.negocioId, entreLimites(req.query.dias, 1, 60, 14)));
}));

app.get('/movimientos', ruta('No se pudieron obtener los movimientos', async (req, res) => {
  res.json(await obtenerMovimientos(req.negocioId, entreLimites(req.query.limite, 1, 200, 15)));
}));

app.post('/ventas', ruta('No se pudo registrar la venta', async (req, res) => {
  const productoId = Number(req.body.productoId);
  const cantidad = Number(req.body.cantidad);
  if (!datosValidos(productoId, cantidad)) {
    return res.status(400).json({ error: 'Elegí un producto y una cantidad mayor a 0' });
  }
  const producto = await buscarProducto(req.negocioId, productoId);
  if (!producto) {
    return res.status(404).json({ error: `No existe un producto con id ${productoId}` });
  }
  const disponible = await stockDe(productoId);
  if (cantidad > disponible) {
    return res.status(409).json({ error: `No hay stock suficiente de ${producto.nombre}: hay ${disponible}` });
  }
  await registrarVenta(productoId, cantidad);
  res.status(201).json({ mensaje: `Venta registrada: ${cantidad} x ${producto.nombre}`, quedan: disponible - cantidad });
}));

app.post('/entradas', ruta('No se pudo registrar la entrada', async (req, res) => {
  const productoId = Number(req.body.productoId);
  const cantidad = Number(req.body.cantidad);
  if (!datosValidos(productoId, cantidad)) {
    return res.status(400).json({ error: 'Elegí un producto y una cantidad mayor a 0' });
  }
  const producto = await buscarProducto(req.negocioId, productoId);
  if (!producto) {
    return res.status(404).json({ error: `No existe un producto con id ${productoId}` });
  }
  await registrarEntrada(productoId, cantidad);
  const ahora = await stockDe(productoId);
  res.status(201).json({ mensaje: `Mercadería cargada: ${cantidad} x ${producto.nombre}`, quedan: ahora });
}));

app.post('/productos', ruta('No se pudo crear el producto', async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const categoria = String(req.body.categoria || '').trim() || null;
  const precioVenta = Number(req.body.precioVenta);
  const stockMinimo = Number(req.body.stockMinimo);
  if (nombre.length < 2 || nombre.length > 120) {
    return res.status(400).json({ error: 'El nombre tiene que tener entre 2 y 120 caracteres' });
  }
  if (categoria && categoria.length > 60) {
    return res.status(400).json({ error: 'La categoría puede tener hasta 60 caracteres' });
  }
  if (!(precioVenta > 0)) {
    return res.status(400).json({ error: 'El precio tiene que ser mayor a 0' });
  }
  if (!Number.isInteger(stockMinimo) || stockMinimo < 0) {
    return res.status(400).json({ error: 'El mínimo tiene que ser un número entero de 0 o más' });
  }
  const id = await crearProducto(req.negocioId, nombre, categoria, precioVenta, stockMinimo);
  res.status(201).json({ mensaje: `Producto creado: ${nombre}`, id });
}));

// Cada media hora se borran las demos de más de 3 horas (por si alguien cerró sin tocar Salir).
async function limpiarDemos() {
  try {
    const borradas = await borrarDemosViejas(3);
    if (borradas) console.log(`Demos viejas borradas: ${borradas}`);
  } catch (error) {
    console.error('No se pudieron limpiar las demos:', error.message);
  }
}
limpiarDemos();
setInterval(limpiarDemos, 30 * 60 * 1000);

app.listen(PUERTO, () => {
  console.log(`Servidor prendido en http://localhost:${PUERTO}`);
});
