async function cargarStock() {
  const respuesta = await fetch('/stock');
  const productos = await respuesta.json();

  const tabla = document.getElementById('tabla-stock');
  tabla.innerHTML = '';

  for (const producto of productos) {
    const fila = document.createElement('tr');
    fila.innerHTML = `
      <td>${producto.id}</td>
      <td>${producto.nombre}</td>
      <td>${producto.stock}</td>
    `;
    tabla.appendChild(fila);
  }
}

cargarStock();