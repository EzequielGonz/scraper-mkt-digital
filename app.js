const form = document.getElementById("form-busqueda");
const estado = document.getElementById("estado");
const mensajeVacio = document.getElementById("mensaje-vacio");
const resultadosDiv = document.getElementById("resultados");
const tablaBody = document.querySelector("#tabla-resultados tbody");
const btnDescargar = document.getElementById("btn-descargar");
const btnBuscar = form.querySelector('button[type="submit"]');

let ultimosNuevos = [];

function columnasCsv() {
  return ["nombre", "categoria", "direccion", "telefono", "sitioWeb", "rating", "cantidadResenas", "urlMaps"];
}

function descargarCsv(filas, nombreArchivo) {
  const columnas = columnasCsv();
  const lineas = [columnas.join(",")];
  for (const fila of filas) {
    lineas.push(
      columnas.map((c) => `"${String(fila[c] || "").replace(/"/g, '""')}"`).join(",")
    );
  }
  const csv = lineas.join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(form).entries());

  mensajeVacio.hidden = true;
  resultadosDiv.hidden = true;
  tablaBody.innerHTML = "";
  ultimosNuevos = [];
  btnBuscar.disabled = true;

  estado.textContent = "Buscando… puede tardar hasta un minuto";
  estado.className = "pastilla es-activo";

  try {
    const resp = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rubro: datos.rubro,
        ubicacion: datos.ubicacion,
        max: datos.max,
      }),
    });

    const json = await resp.json();

    if (!resp.ok) {
      estado.textContent = "Error";
      estado.className = "pastilla es-error";
      mensajeVacio.hidden = false;
      mensajeVacio.textContent = `ERROR: ${json.error || "ocurrió un problema."}`;
      return;
    }

    ultimosNuevos = json.nuevos;
    estado.textContent = `Listo · ${json.nuevos.length} nuevos · ${json.repetidos} repetidos`;
    estado.className = "pastilla es-ok";

    if (json.nuevos.length === 0) {
      mensajeVacio.hidden = false;
      mensajeVacio.textContent = "No se encontraron negocios nuevos (puede que ya estuvieran todos guardados de antes).";
      return;
    }

    resultadosDiv.hidden = false;
    for (const n of json.nuevos) {
      const fila = document.createElement("tr");
      fila.innerHTML = `
        <td>${n.nombre || ""}</td>
        <td>${n.categoria || ""}</td>
        <td>${n.direccion || ""}</td>
        <td>${n.telefono || ""}</td>
      `;
      tablaBody.appendChild(fila);
    }
  } catch (e) {
    estado.textContent = "Error";
    estado.className = "pastilla es-error";
    mensajeVacio.hidden = false;
    mensajeVacio.textContent = `ERROR: no se pudo conectar con el servidor (${e.message})`;
  } finally {
    btnBuscar.disabled = false;
  }
});

btnDescargar.addEventListener("click", () => {
  if (ultimosNuevos.length === 0) return;
  descargarCsv(ultimosNuevos, `negocios_${Date.now()}.csv`);
});

const btnVerHistorial = document.getElementById("btn-ver-historial");
const historialEstado = document.getElementById("historial-estado");

btnVerHistorial.addEventListener("click", async () => {
  btnVerHistorial.disabled = true;
  historialEstado.textContent = "Cargando...";

  try {
    const resp = await fetch("/api/listado");
    const json = await resp.json();

    if (!resp.ok) {
      historialEstado.textContent = `ERROR: ${json.error}`;
      return;
    }

    if (json.total === 0) {
      historialEstado.textContent = "Todavía no hay nada guardado en la base.";
      return;
    }

    historialEstado.textContent = `${json.total} negocios guardados en total. Descargando CSV...`;
    descargarCsv(json.negocios, `historial_completo_${Date.now()}.csv`);
    historialEstado.textContent = `${json.total} negocios guardados en total.`;
  } catch (e) {
    historialEstado.textContent = `ERROR: no se pudo conectar con el servidor (${e.message})`;
  } finally {
    btnVerHistorial.disabled = false;
  }
});
