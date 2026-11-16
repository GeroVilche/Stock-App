const express = require('express');
const { obtenerStock } = require('./db');

const app = express();
const PUERTO = 3000;

app.get('/stock', async (req, res) => {
  try {
    const stock = await obtenerStock();
    res.json(stock);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo obtener el stock' });
  }
});

app.listen(PUERTO, () => {
  console.log(`Servidor prendido en http://localhost:${PUERTO}`);
});