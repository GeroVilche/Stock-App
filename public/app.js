// ---------- Estado y utilidades ----------

const estado = {
  productos: [],
  movimientos: [],
  resumen: null,
  ventasDias: [],
  categoria: 'Todas',
  filtroMovimientos: 'todos',
  busqueda: '',
};

const $ = (selector) => document.querySelector(selector);
const dinero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat('es-AR');
const TIPOS = { venta: 'Venta', entrada: 'Entrada', ajuste: 'Ajuste' };
const VISTAS = { resumen: 'Resumen', productos: 'Productos', movimientos: 'Movimientos', reponer: 'Reponer' };

// Evita que un nombre con símbolos raros (ej: <script>) se interprete como código.
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Todas las llamadas al servidor pasan por acá.
async function api(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, { headers: { 'Content-Type': 'application/json' }, ...opciones });
  if (respuesta.status === 401) {
    window.location.href = '/login';
    throw new Error('Tu sesión venció. Volvé a ingresar.');
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || 'Algo salió mal. Probá de nuevo.');
  return datos;
}

function hace(fechaTexto) {
  const fecha = new Date(fechaTexto);
  const minutos = Math.round((Date.now() - fecha) / 60000);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// Cuánto cambia el stock un movimiento: las ventas restan, el resto suma (los ajustes ya traen su signo).
const cambioDe = (movimiento) => (movimiento.tipo === 'venta' ? -movimiento.cantidad : movimiento.cantidad);
const conSigno = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
const categoriaDe = (producto) => producto.categoria || 'Sin categoría';
const estaBajo = (producto) => producto.stock < producto.stock_minimo;

function avisar(texto, esError = false) {
  const aviso = $('#aviso');
  aviso.textContent = texto;
  aviso.classList.toggle('es-error', esError);
  aviso.classList.add('visible');
  clearTimeout(avisar.temporizador);
  avisar.temporizador = setTimeout(() => aviso.classList.remove('visible'), 4000);
}

// ---------- Carga de datos ----------

async function cargarTodo() {
  const [productos, movimientos, resumen, ventasDias] = await Promise.all([
    api('/stock'),
    api('/movimientos?limite=100'),
    api('/resumen'),
    api('/ventas-por-dia?dias=14'),
  ]);
  Object.assign(estado, { productos, movimientos, resumen, ventasDias });
  dibujar();
}

function dibujar() {
  dibujarIndicadores();
  dibujarGrafico();
  dibujarPestanas();
  dibujarTablas();
  dibujarReponer();
  dibujarMovimientos();
  dibujarFormularios();
}

// ---------- Dibujo de cada parte ----------

function dibujarIndicadores() {
  const r = estado.resumen;
  $('#ind-valor').textContent = dinero.format(r.valor_stock);
  $('#ind-unidades').textContent = numero.format(r.unidades);
  $('#ind-unidades-detalle').textContent = `en ${r.productos} ${r.productos === 1 ? 'producto' : 'productos'}`;
  $('#ind-reponer').textContent = r.para_reponer;
  $('#ind-reponer').classList.toggle('es-alerta', r.para_reponer > 0);
  $('#ind-hoy').textContent = numero.format(r.vendido_hoy);
  $('#ind-hoy-detalle').textContent = r.vendido_hoy ? `${dinero.format(r.ingresos_hoy)} en ventas` : 'todavía sin ventas';

  const contador = $('#contador-reponer');
  contador.textContent = r.para_reponer;
  contador.hidden = r.para_reponer === 0;
}

function dibujarGrafico() {
  const dias = estado.ventasDias;
  const maximo = Math.max(...dias.map((d) => d.unidades), 1);
  const total = dias.reduce((suma, d) => suma + d.unidades, 0);
  $('#grafico-total').textContent = `${numero.format(total)} unidades vendidas`;

  $('#grafico').innerHTML = dias.map((d, i) => {
    const esHoy = i === dias.length - 1;
    const [anio, mes, dia] = d.dia.split('-').map(Number);
    const fecha = new Date(anio, mes - 1, dia);
    const alto = d.unidades ? Math.max((d.unidades / maximo) * 100, 4) : 0;
    const descripcion = `${fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}: ${d.unidades} vendidas`;
    return `
      <div class="dia${esHoy ? ' es-hoy' : ''}" title="${descripcion}">
        <span class="dia-valor">${d.unidades || ''}</span>
        <span class="dia-columna"><span class="dia-barra" style="height:${alto}%"></span></span>
        <span class="dia-etiqueta">${esHoy ? 'Hoy' : fecha.getDate()}</span>
      </div>`;
  }).join('');
}

function dibujarPestanas() {
  const conteo = {};
  for (const p of estado.productos) conteo[categoriaDe(p)] = (conteo[categoriaDe(p)] || 0) + 1;
  const lista = [['Todas', estado.productos.length], ...Object.entries(conteo).sort()];
  if (!lista.some(([c]) => c === estado.categoria)) estado.categoria = 'Todas';

  $('#pestanas').innerHTML = lista.map(([categoria, cantidad]) => `
    <button role="tab" data-categoria="${esc(categoria)}" aria-selected="${categoria === estado.categoria}">
      ${esc(categoria)} <span>${cantidad}</span>
    </button>`).join('');
}

// La barra muestra el stock como el nivel de una botella; la marca dorada es el mínimo.
function filaProducto(p) {
  const tope = Math.max(p.stock, p.stock_minimo * 2, 1);
  const lleno = (p.stock / tope) * 100;
  const minimo = (p.stock_minimo / tope) * 100;
  const bajo = estaBajo(p);
  return `
    <tr class="${bajo ? 'fila-baja' : ''}">
      <td><strong>${esc(p.nombre)}</strong><span class="sub">${esc(categoriaDe(p))}</span></td>
      <td>
        <div class="stock">
          <span class="stock-cantidad">${p.stock}</span>
          <span class="nivel${bajo ? ' es-bajo' : ''}" role="img" aria-label="${p.stock} en stock, mínimo ${p.stock_minimo}">
            <span class="nivel-lleno" style="width:${lleno}%"></span>
            <span class="nivel-minimo" style="left:${minimo}%"></span>
          </span>
        </div>
      </td>
      <td class="num">${p.stock_minimo}</td>
      <td class="num">${dinero.format(p.precio)}</td>
      <td>${bajo ? '<span class="estado estado-bajo">Reponer</span>' : '<span class="estado estado-ok">Bien</span>'}</td>
    </tr>`;
}

function coincideBusqueda(texto) {
  return !estado.busqueda || texto.toLowerCase().includes(estado.busqueda);
}

function dibujarTablas() {
  const visibles = estado.productos.filter((p) => coincideBusqueda(`${p.nombre} ${categoriaDe(p)}`));
  const deLaCategoria = visibles.filter((p) => estado.categoria === 'Todas' || categoriaDe(p) === estado.categoria);
  const vacio = (texto) => `<tr><td colspan="5" class="vacio">${texto}</td></tr>`;
  const mensajeVacio = estado.productos.length
    ? 'Ningún producto coincide con la búsqueda.'
    : 'Todavía no cargaste productos. Creá el primero desde Productos.';

  $('#tabla-resumen').innerHTML = deLaCategoria.map(filaProducto).join('') || vacio(mensajeVacio);
  $('#tabla-productos').innerHTML = visibles.map(filaProducto).join('') || vacio(mensajeVacio);
  $('#conteo-stock').textContent = `${deLaCategoria.length} de ${estado.productos.length} productos`;
}

function dibujarReponer() {
  const bajos = estado.productos
    .filter(estaBajo)
    .sort((a, b) => (a.stock - a.stock_minimo) - (b.stock - b.stock_minimo));

  const html = bajos.map((p) => {
    const faltan = p.stock_minimo - p.stock;
    return `
      <li class="item">
        <div class="item-texto">
          <strong>${esc(p.nombre)}</strong>
          <span class="sub">Quedan ${p.stock}, faltan ${faltan} para el mínimo</span>
        </div>
        <button class="btn btn-claro btn-chico" data-reponer="${p.id}" data-faltan="${faltan}">Cargar</button>
      </li>`;
  }).join('') || '<li class="vacio">Todo el stock está por encima del mínimo.</li>';

  $('#lista-reponer').innerHTML = html;
  $('#lista-reponer-completa').innerHTML = html;
}

function dibujarMovimientos() {
  $('#lista-movimientos').innerHTML = estado.movimientos.slice(0, 6).map((m) => {
    const cambio = cambioDe(m);
    return `
      <li class="item">
        <span class="mov-icono ${cambio > 0 ? 'sube' : 'baja'}" aria-hidden="true">${cambio > 0 ? '↑' : '↓'}</span>
        <div class="item-texto">
          <strong>${esc(m.nombre)}</strong>
          <span class="sub">${TIPOS[m.tipo]}, ${hace(m.fecha)}</span>
        </div>
        <span class="mov-cantidad ${cambio > 0 ? 'sube' : 'baja'}">${conSigno(cambio)}</span>
      </li>`;
  }).join('') || '<li class="vacio">Todavía no hay movimientos.</li>';

  const filtrados = estado.movimientos
    .filter((m) => estado.filtroMovimientos === 'todos' || m.tipo === estado.filtroMovimientos)
    .filter((m) => coincideBusqueda(m.nombre));

  $('#tabla-movimientos').innerHTML = filtrados.map((m) => {
    const cambio = cambioDe(m);
    const fecha = new Date(m.fecha);
    return `
      <tr>
        <td class="fecha-celda">${fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
          <span class="sub">${fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span></td>
        <td><strong>${esc(m.nombre)}</strong></td>
        <td><span class="tipo tipo-${m.tipo}">${TIPOS[m.tipo]}</span></td>
        <td class="num mov-cantidad ${cambio > 0 ? 'sube' : 'baja'}">${conSigno(cambio)}</td>
        <td class="nota">${esc(m.nota || '')}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="5" class="vacio">No hay movimientos con ese filtro.</td></tr>';
}

function dibujarFormularios() {
  for (const select of [$('#venta-producto'), $('#entrada-producto')]) {
    const elegido = select.value;
    select.innerHTML = estado.productos
      .map((p) => `<option value="${p.id}">${esc(p.nombre)} (hay ${p.stock})</option>`)
      .join('');
    if (elegido) select.value = elegido;
  }
  const categorias = [...new Set(estado.productos.map((p) => p.categoria).filter(Boolean))];
  $('#lista-categorias').innerHTML = categorias.map((c) => `<option value="${esc(c)}">`).join('');
}

// ---------- Navegación entre secciones ----------

function mostrarVista() {
  const pedida = location.hash.slice(1);
  const vista = VISTAS[pedida] ? pedida : 'resumen';
  for (const id of Object.keys(VISTAS)) $(`#vista-${id}`).hidden = id !== vista;
  document.querySelectorAll('.menu a').forEach((enlace) => {
    if (enlace.dataset.vista === vista) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  });
  $('#titulo-vista').textContent = VISTAS[vista];
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', mostrarVista);

// ---------- Ventanas y botones ----------

function abrirDialogo(id) {
  const dialogo = document.getElementById(id);
  dialogo.querySelector('.dialogo-error').textContent = '';
  dialogo.showModal();
}

document.addEventListener('click', (evento) => {
  const objetivo = evento.target;

  const abrir = objetivo.closest('[data-abrir]');
  if (abrir) abrirDialogo(abrir.dataset.abrir);

  const cerrar = objetivo.closest('[data-cerrar]');
  if (cerrar) cerrar.closest('dialog').close();

  const reponer = objetivo.closest('[data-reponer]');
  if (reponer) {
    $('#entrada-producto').value = reponer.dataset.reponer;
    $('#entrada-cantidad').value = reponer.dataset.faltan;
    abrirDialogo('dialogo-entrada');
  }

  const pestana = objetivo.closest('[data-categoria]');
  if (pestana) {
    estado.categoria = pestana.dataset.categoria;
    dibujarPestanas();
    dibujarTablas();
  }

  const filtro = objetivo.closest('[data-filtro]');
  if (filtro) {
    estado.filtroMovimientos = filtro.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach((b) => b.setAttribute('aria-selected', b === filtro));
    dibujarMovimientos();
  }
});

// Clic afuera de la ventana = cerrarla.
document.querySelectorAll('dialog').forEach((dialogo) => {
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) dialogo.close();
  });
});

function conectarFormulario(idFormulario, ruta, armarDatos) {
  const formulario = document.getElementById(idFormulario);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const boton = formulario.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      const datos = await api(ruta, { method: 'POST', body: JSON.stringify(armarDatos()) });
      formulario.closest('dialog').close();
      if (formulario.dataset.limpiar === 'todo') formulario.reset();
      else formulario.querySelector('input[type="number"]').value = 1;
      avisar(datos.quedan !== undefined ? `${datos.mensaje}. Quedan ${datos.quedan}.` : datos.mensaje);
      await cargarTodo();
    } catch (error) {
      formulario.querySelector('.dialogo-error').textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  });
}

conectarFormulario('form-venta', '/ventas', () => ({
  productoId: Number($('#venta-producto').value),
  cantidad: Number($('#venta-cantidad').value),
}));

conectarFormulario('form-entrada', '/entradas', () => ({
  productoId: Number($('#entrada-producto').value),
  cantidad: Number($('#entrada-cantidad').value),
}));

conectarFormulario('form-producto', '/productos', () => ({
  nombre: $('#nuevo-nombre').value,
  categoria: $('#nuevo-categoria').value,
  precioVenta: Number($('#nuevo-precio').value),
  stockMinimo: Number($('#nuevo-minimo').value),
}));

// ---------- Búsqueda ----------

$('#buscador').addEventListener('input', (evento) => {
  estado.busqueda = evento.target.value.trim().toLowerCase();
  dibujarTablas();
  dibujarMovimientos();
});

// Atajo: la tecla "/" va directo al buscador.
document.addEventListener('keydown', (evento) => {
  const escribiendo = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (evento.key === '/' && !escribiendo && !document.querySelector('dialog[open]')) {
    evento.preventDefault();
    $('#buscador').focus();
  }
});

$('#btn-salir').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ---------- Arranque ----------

async function iniciar() {
  mostrarVista();
  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#fecha-hoy').textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);

  try {
    const negocio = await api('/negocio');
    $('#nombre-negocio').textContent = negocio.nombre;
    document.title = `Stock de ${negocio.nombre}`;
    $('#nombre-usuario').textContent = negocio.usuario;
    $('#avatar').textContent = negocio.usuario.slice(0, 2).toUpperCase();
    await cargarTodo();
  } catch (error) {
    avisar(error.message, true);
  }
}

iniciar();
// Cada minuto se actualiza solo (por si alguien más cargó algo).
setInterval(() => cargarTodo().catch(() => {}), 60000);
