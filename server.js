const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const {
  obtenerStock, buscarProducto, stockDe, registrarVenta,
  registrarEntrada, crearProducto, obtenerMovimientos,
} = require('./db');

const app = express();
const PUERTO = process.env.PORT || 3000;
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000;

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

function crearToken(usuario) {
  const datos = Buffer.from(JSON.stringify({ usuario, vence: Date.now() + DURACION_SESION_MS })).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}

function tokenValido(token) {
  if (!token) return false;
  const [datos, firma] = token.split('.');
  if (!datos || !firma || !iguales(firma, firmar(datos))) return false;
  try {
    const { vence } = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return Date.now() < vence;
  } catch {
    return false;
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

// ---------- Rutas públicas (no piden login) ----------

app.get('/login', (req, res) => {
  if (tokenValido(leerCookie(req, 'sesion'))) return res.redirect('/');
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
  res.cookie('sesion', crearToken(usuario), {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: DURACION_SESION_MS,
  });
  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  res.clearCookie('sesion');
  res.json({ ok: true });
});

// ---------- De acá para abajo, todo pide login ----------

function requerirLogin(req, res, next) {
  if (tokenValido(leerCookie(req, 'sesion'))) return next();
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

app.get('/stock', async (req, res) => {
  try {
    res.json(await obtenerStock());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo obtener el stock' });
  }
});

app.get('/movimientos', async (req, res) => {
  try {
    res.json(await obtenerMovimientos());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudieron obtener los movimientos' });
  }
});

app.post('/ventas', async (req, res) => {
  try {
    const productoId = Number(req.body.productoId);
    const cantidad = Number(req.body.cantidad);
    if (!datosValidos(productoId, cantidad)) {
      return res.status(400).json({ error: 'productoId y cantidad tienen que ser números enteros mayores a 0' });
    }
    const producto = await buscarProducto(productoId);
    if (!producto) {
      return res.status(404).json({ error: `No existe un producto con id ${productoId}` });
    }
    const disponible = await stockDe(productoId);
    if (cantidad > disponible) {
      return res.status(409).json({ error: `No hay stock suficiente de ${producto.nombre}: hay ${disponible}` });
    }
    await registrarVenta(productoId, cantidad);
    res.status(201).json({ mensaje: `Venta registrada: ${cantidad} x ${producto.nombre}`, quedan: disponible - cantidad });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo registrar la venta' });
  }
});

app.post('/entradas', async (req, res) => {
  try {
    const productoId = Number(req.body.productoId);
    const cantidad = Number(req.body.cantidad);
    if (!datosValidos(productoId, cantidad)) {
      return res.status(400).json({ error: 'productoId y cantidad tienen que ser números enteros mayores a 0' });
    }
    const producto = await buscarProducto(productoId);
    if (!producto) {
      return res.status(404).json({ error: `No existe un producto con id ${productoId}` });
    }
    await registrarEntrada(productoId, cantidad);
    const ahora = await stockDe(productoId);
    res.status(201).json({ mensaje: `Entrada registrada: ${cantidad} x ${producto.nombre}`, quedan: ahora });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo registrar la entrada' });
  }
});

app.post('/productos', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const categoria = String(req.body.categoria || '').trim() || null;
    const precioVenta = Number(req.body.precioVenta);
    const stockMinimo = Number(req.body.stockMinimo);
    if (nombre.length < 2 || nombre.length > 120) {
      return res.status(400).json({ error: 'El nombre tiene que tener entre 2 y 120 caracteres' });
    }
    if (!(precioVenta > 0)) {
      return res.status(400).json({ error: 'El precio tiene que ser mayor a 0' });
    }
    if (!Number.isInteger(stockMinimo) || stockMinimo < 0) {
      return res.status(400).json({ error: 'El mínimo tiene que ser un número entero de 0 o más' });
    }
    const id = await crearProducto(nombre, categoria, precioVenta, stockMinimo);
    res.status(201).json({ mensaje: `Producto creado: ${nombre} (id ${id})` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo crear el producto' });
  }
});

app.listen(PUERTO, () => {
  console.log(`Servidor prendido en http://localhost:${PUERTO}`);
});