const tabla = document.getElementById('tabla-stock');
const selectProducto = document.getElementById('producto');
const inputCantidad = document.getElementById('cantidad');
const formVenta = document.getElementById('form-venta');
const mensaje = document.getElementById('mensaje');

async function cargarStock() {
  const respuesta = await fetch('/stock');
  const productos = await respuesta.json();

  tabla.innerHTML = '';
  selectProducto.innerHTML = '';

  for (const producto of productos) {
    const fila = document.createElement('tr');
    fila.innerHTML = `
      <td>${producto.id}</td>
      <td>${producto.nombre}</td>
      <td>${producto.stock}</td>
    `;
    tabla.appendChild(fila);

    const opcion = document.createElement('option');
    opcion.value = producto.id;
    opcion.textContent = `${producto.nombre} (hay ${producto.stock})`;
    selectProducto.appendChild(opcion);
  }
}

formVenta.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const respuesta = await fetch('/ventas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productoId: Number(selectProducto.value),
      cantidad: Number(inputCantidad.value),
    }),
  });
  const datos = await respuesta.json();

  if (respuesta.ok) {
    mensaje.textContent = `${datos.mensaje}. Quedan ${datos.quedan}.`;
    mensaje.className = 'ok';
    inputCantidad.value = 1;
  } else {
    mensaje.textContent = datos.error;
    mensaje.className = 'error';
  }

  cargarStock();
});

cargarStock();