const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const SCROLL_PAUSE_MS = 1200;
const MAX_INTENTOS_SIN_NOVEDAD = 4;
const KV_HASH = "negocios";
const MAX_RESULTADOS_PERMITIDO = 30;

function limpiarTexto(texto) {
  return (texto || "").replace(/\s+/g, " ").trim();
}

function hacerId(nombre, direccion) {
  const base = `${(nombre || "").trim().toLowerCase()}|${(direccion || "").trim().toLowerCase()}`;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 20);
}

async function cerrarCartelCookies(pagina) {
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await pagina.evaluate(() => {
      const botones = Array.from(document.querySelectorAll("button"));
      const candidato = botones.find((b) =>
        /aceptar todo|rechazar todo/i.test(b.textContent || "")
      );
      if (candidato) candidato.click();
    });
  } catch {}
}

async function scrollearResultados(pagina, maxResultados) {
  const feedSelector = 'div[role="feed"]';
  await pagina.waitForSelector(feedSelector, { timeout: 20000 });

  let intentosSinNovedad = 0;
  let cantidadAnterior = 0;

  while (true) {
    const cantidadActual = await pagina.$$eval(
      `${feedSelector} div[role="article"]`,
      (els) => els.length
    );

    if (cantidadActual >= maxResultados) break;

    if (cantidadActual === cantidadAnterior) {
      intentosSinNovedad += 1;
    } else {
      intentosSinNovedad = 0;
    }

    if (intentosSinNovedad >= MAX_INTENTOS_SIN_NOVEDAD) break;

    cantidadAnterior = cantidadActual;

    await pagina.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) feed.scrollTop = feed.scrollHeight;
    }, feedSelector);

    await new Promise((r) => setTimeout(r, SCROLL_PAUSE_MS));
  }
}

async function extraerTarjetas(pagina, maxResultados) {
  return pagina.evaluate((max) => {
    function limpiar(t) {
      return (t || "").replace(/\s+/g, " ").trim();
    }

    const tarjetas = Array.from(
      document.querySelectorAll('div[role="feed"] div[role="article"]')
    ).slice(0, max);

    return tarjetas.map((tarjeta) => {
      const nombreEl = tarjeta.querySelector(".qBF1Pd");
      const nombre = limpiar(nombreEl ? nombreEl.textContent : "");

      const linkEl = tarjeta.querySelector("a.hfpxzc");
      const urlMaps = linkEl ? linkEl.getAttribute("href") : "";

      let rating = "";
      let cantidadResenas = "";
      const ratingEl = tarjeta.querySelector('span[role="img"]');
      if (ratingEl) {
        const aria = ratingEl.getAttribute("aria-label") || "";
        const match = aria.match(/([\d,.]+)\s*estrellas.*?([\d.,]+)\s*rese/i);
        if (match) {
          rating = match[1];
          cantidadResenas = match[2];
        } else {
          const match2 = aria.match(/([\d,.]+)/);
          if (match2) rating = match2[1];
        }
      }

      const bloques = [];
      const walker = document.createTreeWalker(tarjeta, NodeFilter.SHOW_TEXT);
      let nodo;
      while ((nodo = walker.nextNode())) {
        const val = limpiar(nodo.textContent);
        if (val) bloques.push(val);
      }

      let categoria = "";
      let direccion = "";
      let telefono = "";
      const telefonoRegex = /(\+?\d[\d\s\-()]{6,}\d)/;

      for (const linea of bloques) {
        const matchTel = linea.match(telefonoRegex);
        if (matchTel && !telefono) {
          telefono = matchTel[1].trim();
        } else if (linea.includes("·") && !categoria) {
          const partes = linea.split("·").map((p) => p.trim());
          if (partes.length >= 2) {
            categoria = partes[0];
            direccion = partes[partes.length - 1];
          }
        }
      }

      let sitioWeb = "";
      const sitioWebEl = tarjeta.querySelector(
        'a[data-value="Sitio web"], a[aria-label*="Sitio web" i]'
      );
      if (sitioWebEl) sitioWeb = sitioWebEl.getAttribute("href") || "";

      return { nombre, categoria, direccion, telefono, sitioWeb, rating, cantidadResenas, urlMaps };
    });
  }, maxResultados);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido, usá POST." });
    return;
  }

  let rubro = "";
  let ubicacion = "";
  let max = 15;

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    rubro = limpiarTexto(body.rubro);
    ubicacion = limpiarTexto(body.ubicacion);
    max = Math.max(1, Math.min(MAX_RESULTADOS_PERMITIDO, parseInt(body.max, 10) || 15));
  } catch {
    res.status(400).json({ error: "El cuerpo de la petición no es un JSON válido." });
    return;
  }

  if (!rubro) {
    res.status(400).json({ error: "Falta indicar qué buscar." });
    return;
  }

  const consulta = `${rubro} ${ubicacion}`.trim();
  let navegador;

  try {
    navegador = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const pagina = await navegador.newPage();
    const url = `https://www.google.com/maps/search/${encodeURIComponent(consulta)}`;
    await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    await cerrarCartelCookies(pagina);
    await scrollearResultados(pagina, max);
    const tarjetas = await extraerTarjetas(pagina, max);

    await navegador.close();
    navegador = null;

    const nuevos = [];
    let repetidos = 0;

    for (const negocio of tarjetas) {
      if (!negocio.nombre) continue;

      const id = hacerId(negocio.nombre, negocio.direccion);
      const yaExiste = await kv.hget(KV_HASH, id);

      if (yaExiste) {
        repetidos += 1;
        continue;
      }

      const registro = {
        ...negocio,
        id,
        busqueda: consulta,
        guardado: new Date().toISOString(),
      };
      await kv.hset(KV_HASH, { [id]: JSON.stringify(registro) });
      nuevos.push(registro);
    }

    res.status(200).json({
      ok: true,
      totalLeidos: tarjetas.length,
      nuevos,
      repetidos,
    });
  } catch (e) {
    if (navegador) {
      try {
        await navegador.close();
      } catch {}
    }
    res.status(500).json({ error: e.message || "Error desconocido al scrapear." });
  }
};
