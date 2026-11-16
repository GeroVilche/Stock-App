SELECT
  p.nombre,
  p.stock_minimo,
  SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END) AS stock_actual
FROM productos p
JOIN movimientos m ON m.producto_id = p.id
GROUP BY p.id, p.nombre, p.stock_minimo
HAVING SUM(CASE WHEN m.tipo = 'venta' THEN -m.cantidad ELSE m.cantidad END) < p.stock_minimo;