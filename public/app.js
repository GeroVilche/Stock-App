const tabla = document.getElementById('tabla-stock');

const formVenta = document.getElementById('form-venta');
const selectVenta = document.getElementById('producto');
const cantidadVenta = document.getElementById('cantidad');
const mensajeVenta = document.getElementById('mensaje');

const formEntrada = document.getElementById('form-entrada');
const selectEntrada = document.getElementById('producto-entrada');
const cantidadEntrada = document.getElementById('cantidad-entrada');
const mensajeEntrada = document.getElementById('mensaje-entrada');

function llenarSelect(select, productos) {
  const elegido = select.value;
  select.innerHTML = '';
  for (const producto of productos) {
    const opcion = document.createElement('option');
    opcion.value = producto.id;
    opcion.textContent = `${producto.nombre} (hay ${producto.stock})`;
    select.appendChild(opcion);
  }
  if (elegido) select.value = elegido;
}

async function cargarStock() {
  const respuesta = await fetch('/stock');
  const productos = await respuesta.json();

  tabla.innerHTML = '';
  for (const producto of productos) {
        const fila = document.createElement('tr');
    const stockBajo = producto.stock < producto.stock_minimo;
    if (stockBajo) fila.classList.add('stock-bajo');
    fila.innerHTML = `
      <td>${producto.id}</td>
      <td>${producto.nombre}</td>
      <td>${producto.stock}${stockBajo ? ' <span class="aviso">Reponer</span>' : ''}</td>
      <td>${producto.stock_minimo}</td>
    `;
    tabla.appendChild(fila);
  }

  llenarSelect(selectVenta, productos);
  llenarSelect(selectEntrada, productos);
}

async function enviarMovimiento(ruta, select, inputCantidad, mensaje) {
  const respuesta = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productoId: Number(select.value),
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
}

formVenta.addEventListener('submit', (evento) => {
  evento.preventDefault();
  enviarMovimiento('/ventas', selectVenta, cantidadVenta, mensajeVenta);
});

formEntrada.addEventListener('submit', (evento) => {
  evento.preventDefault();
  enviarMovimiento('/entradas', selectEntrada, cantidadEntrada, mensajeEntrada);
});

const formProducto = document.getElementById('form-producto');
const mensajeProducto = document.getElementById('mensaje-producto');

formProducto.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const respuesta = await fetch('/productos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: document.getElementById('nuevo-nombre').value,
      categoria: document.getElementById('nuevo-categoria').value,
      precioVenta: Number(document.getElementById('nuevo-precio').value),
      stockMinimo: Number(document.getElementById('nuevo-minimo').value),
    }),
  });
  const datos = await respuesta.json();

  if (respuesta.ok) {
    mensajeProducto.textContent = datos.mensaje;
    mensajeProducto.className = 'ok';
    formProducto.reset();
  } else {
    mensajeProducto.textContent = datos.error;
    mensajeProducto.className = 'error';
  }

  cargarStock();
});

cargarStock();