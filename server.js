const express = require('express');
const { obtenerStock, buscarProducto, stockDe, registrarVenta, registrarEntrada } = require('./db');

const app = express();
const PUERTO = 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/stock', async (req, res) => {
  try {
    res.json(await obtenerStock());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo obtener el stock' });
  }
});

app.post('/ventas', async (req, res) => {
  try {
    const productoId = Number(req.body.productoId);
    const cantidad = Number(req.body.cantidad);

    if (!Number.isInteger(productoId) || !Number.isInteger(cantidad) || cantidad <= 0) {
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

    if (!Number.isInteger(productoId) || !Number.isInteger(cantidad) || cantidad <= 0) {
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

app.listen(PUERTO, () => {
  console.log(`Servidor prendido en http://localhost:${PUERTO}`);
});