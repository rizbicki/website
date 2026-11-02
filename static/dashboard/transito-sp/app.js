"use strict";

// ------------------------------------------------------------------ paleta
// rampas sequenciais (monotônicas, validadas): calor = sinistros com vítimas, ameixa = mortes, azul = motociclistas
const CALOR = ["#fee3a2", "#fdbf6f", "#fb9549", "#ef6a33", "#d84525", "#b02a1c", "#7d1915"];
const AMEIXA = ["#e3d6f0", "#c9b0e3", "#ad8ad4", "#9067c4", "#7349ad", "#583390", "#3d2068"];
const AZUL = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const COR = { sin: "#ef6a33", mortes: "#7349ad", tinta: "#15181d", tinta2: "#4a515b", mudo: "#737a84",
  grade: "#ecebe6", eixo: "#d4d0c6", vazio: "#f1efe9", semDado: "#e2e1dc", urbana: "#8b9097" };
// modos de deslocamento: moto e pedestre em destaque, automóvel e outros como contexto (neutros)
const COR_MODO = { "Motocicleta": "#2a78d6", "Pedestre": "#16956a", "Automóvel": "#5b6472", "Bicicleta/outros": "#a9adb3" };
const NOME_MODO = { "Motocicleta": "Motociclistas", "Pedestre": "Pedestres", "Automóvel": "Ocupantes de automóvel", "Bicicleta/outros": "Ciclistas e outros" };
const GRUPOS_MODO = [["Motocicleta", ["Motocicleta"]], ["Pedestre", ["Pedestre"]], ["Automóvel", ["Automóvel"]], ["Bicicleta/outros", ["Bicicleta", "Outros"]]];

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGOS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
  "outubro", "novembro", "dezembro"];
const N_MARCADOS = 10;
const POP_GRANDE = 50000;
const MIN_PONTO = 5;                               // sinistros no período para entrar na lista de pontos críticos
const TOP = { pontos: 30, vias: 30, trechos: 20 }; // tamanho das listas do município

const INDICADORES = {
  tx_mortes_hab: { titulo: "Mortes por 100 mil habitantes", casas: 1, unidade: "mortes por 100 mil hab. por ano", cores: AMEIXA },
  tx_sin_hab: { titulo: "Sinistros com vítimas por 100 mil habitantes", casas: 0, unidade: "sinistros por 100 mil hab. por ano", cores: CALOR },
  tx_mortes_veic: { titulo: "Mortes por 10 mil veículos", casas: 2, unidade: "mortes por 10 mil veículos por ano", cores: AMEIXA },
  pct_mortes_moto: { titulo: "Motociclistas entre os mortos", casas: 0, sufixo: "%", unidade: "das mortes", cores: AZUL, min: 10 },
};

const st = { estado: null, porCod: {}, mun: null, vista: null, indicador: "tx_mortes_hab", modoMapa: "n", aba: "pontos", hora: "n",
  locaisTipo: "pontos", locaisOrdem: "n", nLocais: 10, camadaHex: null, camadaDestaque: null, marcadores: null, ativo: null,
  vistaLocal: "sat", rolagemEstado: 0, estadoDesenhado: false,
  periodo: null,  // [primeiro, último ano] escolhidos no município; null = todos os anos
  area: null,     // retângulo do mapa que filtra os pontos críticos e as rodovias; null = município todo
  listas: null, hexPeriodo: null, retArea: null, movProg: 0 };

// ------------------------------------------------------------------ utilidades

const fmt = (v, casas = 0) => v == null || !isFinite(v) ? "—" :
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };
const $ = id => document.getElementById(id);
const svgEl = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const txt = (attrs, conteudo) => Object.assign(svgEl("text", attrs), { textContent: conteudo });
const plural = (n, um, varios) => `${fmt(n)} ${n === 1 ? um : varios}`;
const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

function fmtGrande(n, unidade) {
  if (n >= 1e6) return `${fmt(n / 1e6, n >= 1e7 ? 1 : 2)} milhões de ${unidade}`;
  return `${fmt(n)} ${unidade}`;
}
const fmtPop = n => n >= 1e6 ? `${fmt(n / 1e6, 1)} mi hab.` : n >= 1e4 ? `${fmt(n / 1e3)} mil hab.` : `${fmt(n)} hab.`;

function regiao(r) {
  if (!r) return "";
  const t = r.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/ (De|Do|Dos|Da|Das) /g, s => s.toLowerCase());
  if (r.startsWith("METROPOLITANA")) return "Região " + t;
  if (r === "BAIXADA SANTISTA") return t;
  if (r === "CENTRAL") return "Região Central";
  return "Região de " + t;
}

function quebras(valores, k) {
  const v = valores.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const q = [];
  for (let i = 1; i < k; i++) q.push(v[Math.min(v.length - 1, Math.floor(i * v.length / k))]);
  return [...new Set(q)];
}
const classe = (x, q) => { let i = 0; while (i < q.length && x > q[i]) i++; return i; };
// n cores espalhadas pela rampa, da mais clara à mais escura
const rampa = (cores, n) => n <= 1 ? [cores[3]] : Array.from({ length: n }, (_, i) => cores[Math.round(i * (cores.length - 1) / (n - 1))]);

// medida de texto para dimensionar margens dos gráficos
const ctx2d = document.createElement("canvas").getContext("2d");
let FONTE = "system-ui, sans-serif";
const larguraTexto = (t, tam = 12, peso = 400) => { ctx2d.font = `${peso} ${tam}px ${FONTE}`; return ctx2d.measureText(t).width; };

function escalaBonita(max, alvo = 4) {
  if (!(max > 0)) return { passo: 1, topo: 1 };
  const bruto = max / alvo, mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * mag).find(p => p >= bruto - 1e-9);
  return { passo, topo: Math.ceil(max / passo - 1e-9) * passo };
}
const casasDoPasso = p => Number.isInteger(p) ? 0 : p >= 1 ? 1 : Math.ceil(-Math.log10(p));

// ------------------------------------------------------------------ dica (tooltip dos gráficos)

const dica = $("dica");
function mostraDica(ev, html) {
  dica.innerHTML = html; dica.hidden = false;
  const w = dica.offsetWidth, h = dica.offsetHeight;
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 16;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 16;
  dica.style.left = Math.max(8, x) + "px"; dica.style.top = Math.max(8, y) + "px";
}
const escondeDica = () => { dica.hidden = true; };
const comDica = (alvo, html) => { alvo.addEventListener("pointermove", ev => mostraDica(ev, html)); alvo.addEventListener("pointerleave", escondeDica); };
const linhaDica = (cor, valor, nome, bloco = false) =>
  `<div class="l"><i style="background:${cor}${bloco ? ";height:10px;width:10px;border-radius:2px" : ""}"></i><b>${valor}</b><span class="s">${esc(nome)}</span></div>`;

// ------------------------------------------------------------------ componentes

function legendaEscala(cores, q, casas = 0, sufixo = "") {
  const box = el("div", { className: "escala" });
  const c = el("div", { className: "cores" });
  cores.forEach(cor => c.appendChild(el("span", { style: `background:${cor}` })));
  const m = el("div", { className: "marcas" });
  q.slice(0, cores.length - 1).forEach((v, i) => m.appendChild(el("span", { style: `left:${(i + 1) * 40 - 1}px`, textContent: fmt(v, casas) + sufixo })));
  m.style.width = cores.length * 40 + "px";
  box.appendChild(c); box.appendChild(m);
  return box;
}

function legendaSerie(series, tipo = "linha") {
  return el("div", { className: "legenda-serie" }, series.map(s =>
    `<span><i class="${tipo === "bloco" ? "bloco" : ""}" style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join(""));
}

function segmentado(id, aoMudar) {
  const box = $(id);
  const bs = box.querySelectorAll("button");
  bs.forEach(b => {
    b.setAttribute("aria-pressed", b.classList.contains("ativo"));
    b.addEventListener("click", () => {
      bs.forEach(x => { x.classList.toggle("ativo", x === b); x.setAttribute("aria-pressed", x === b); });
      aoMudar(b.dataset.v);
    });
  });
}

const novoSvg = (W, H, rotulo = "") => svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": rotulo });

function barraV(x, y, w, h, r) {  // coluna com topo arredondado e base reta
  if (h <= 0) return "";
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function barraH(x, y, w, h, r) {  // barra com ponta arredondada e base reta
  if (w <= 0) return "";
  r = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

// ------------------------------------------------------------------ busca de municípios

function criaBusca(box) {
  const input = box.querySelector("input"), ul = box.querySelector(".sugestoes");
  const id = "sug-" + Math.random().toString(36).slice(2, 8);
  ul.id = id;
  Object.entries({ role: "combobox", "aria-autocomplete": "list", "aria-controls": id, "aria-expanded": "false" })
    .forEach(([k, v]) => input.setAttribute(k, v));
  let res = [], sel = -1;
  const fecha = () => { ul.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); sel = -1; };
  const escolhe = m => { fecha(); input.value = ""; input.blur(); location.hash = m.cod; };
  const marca = () => {
    [...ul.children].forEach((li, i) => li.setAttribute("aria-selected", i === sel));
    if (sel >= 0) { input.setAttribute("aria-activedescendant", `${id}-${sel}`); ul.children[sel].scrollIntoView({ block: "nearest" }); }
  };
  const destaca = (nome, q) => {
    const i = norm(nome).indexOf(q);
    return i < 0 ? esc(nome) : esc(nome.slice(0, i)) + "<mark>" + esc(nome.slice(i, i + q.length)) + "</mark>" + esc(nome.slice(i + q.length));
  };
  const atualiza = () => {
    const q = norm(input.value.trim());
    if (!q) { fecha(); return; }
    res = st.busca.filter(m => m.chave.includes(q))
      .sort((a, b) => (b.chave.startsWith(q) - a.chave.startsWith(q)) || (b.pop - a.pop)).slice(0, 8);
    ul.innerHTML = "";
    if (!res.length) ul.appendChild(el("li", { className: "vazio", textContent: "Nenhum município encontrado" }));
    res.forEach((m, i) => {
      const li = el("li", { id: `${id}-${i}` }, `<span>${destaca(m.nome, q)}</span><small>${fmtPop(m.pop)}</small>`);
      li.setAttribute("role", "option");
      li.addEventListener("mousedown", ev => { ev.preventDefault(); escolhe(m); });
      ul.appendChild(li);
    });
    sel = res.length ? 0 : -1;
    ul.hidden = false; input.setAttribute("aria-expanded", "true");
    marca();
  };
  input.addEventListener("input", atualiza);
  input.addEventListener("focus", () => { if (input.value.trim()) atualiza(); });
  input.addEventListener("blur", fecha);
  input.addEventListener("keydown", ev => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (ul.hidden) atualiza();
      else if (res.length) { sel = (sel + (ev.key === "ArrowDown" ? 1 : res.length - 1)) % res.length; marca(); }
    } else if (ev.key === "Enter") {
      if (sel >= 0 && res[sel]) { ev.preventDefault(); escolhe(res[sel]); }
    } else if (ev.key === "Escape") { fecha(); input.blur(); }
  });
}

// ------------------------------------------------------------------ mapas: base e imagens

const BASE = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
const camadaBase = () => L.tileLayer(BASE + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Base: Esri, HERE, Garmin, &copy; OpenStreetMap", maxNativeZoom: 16, maxZoom: 18 });

const SATELITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
// largura do terreno na imagem e diâmetro do círculo que marca o local, em metros
// (o mesmo círculo do mapa: ponto com ≈100 m de diâmetro, trecho de rodovia com raio de 500 m)
const VISTA = { ponto: { largura: 240, circulo: 110 }, trecho: { largura: 1600, circulo: 1000 } };

// imagem centrada no local, pedida em Web Mercator para sair sem distorção e com o dobro de pixels (telas retina)
function urlSatelite(lat, lon, largura, w, h, escala = 2) {
  const R = 6378137, x = R * lon * Math.PI / 180, y = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const dx = largura / 2 / Math.cos(lat * Math.PI / 180), dy = dx * h / w;
  const bbox = [x - dx, y - dy, x + dx, y + dy].map(v => v.toFixed(1)).join(",");
  return `${SATELITE}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${Math.round(escala * w)},${Math.round(escala * h)}&format=jpg&f=image`;
}

// A Esri responde com erro quando se pede mais resolução do que a imagem tem no local (em boa parte do interior,
// ≈0,6 m por pixel). Se a imagem falha, pede de novo com metade dos pixels, até duas vezes.
document.addEventListener("error", ev => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.sat) return;
  const escala = Number(img.dataset.escala || 2) / 2;
  if (escala < 0.5) return;
  img.dataset.escala = escala;
  const [lat, lon, largura, w, h] = img.dataset.sat.split(",").map(Number);
  img.src = urlSatelite(lat, lon, largura, w, h, escala);
}, true);

// Street View no popup (Maps Embed API, gratuita). A chave é pública por natureza: no Google Cloud, ela só
// funciona nos sites autorizados e só para a Maps Embed API. Vazia, o popup mostra só o link para o Street View.
// AO PUBLICAR NUM DOMÍNIO NOVO, autorize-o na chave, senão o Street View mostra erro (README, "Antes de publicar").
const CHAVE_GOOGLE = "AIzaSyCktGWqub1dthieq6Ey_VnpHjG6D_VaXdg";
const linkStreetView = (lat, lon) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
const embedStreetView = (lat, lon) => `https://www.google.com/maps/embed/v1/streetview?key=${CHAVE_GOOGLE}&location=${lat},${lon}&fov=90&language=pt-BR`;

// sem imagem quando o local é aproximado: a foto sugeriria uma precisão que o dado não tem
const temImagem = x => x.lat != null && !x.aproximado;

function miniatura(tipo, x, w, h, alt = "") {
  const tam = `width:${w}px;height:${h}px`;
  if (!temImagem(x)) return `<span class="miniatura vazia" style="${tam}" title="${x.aproximado ? "Local aproximado: sem imagem" : "Sem coordenada"}"></span>`;
  const v = VISTA[tipo], d = Math.round(v.circulo / v.largura * w);
  return `<span class="miniatura" style="${tam}"><img src="${urlSatelite(x.lat, x.lon, v.largura, w, h)}" data-sat="${[x.lat, x.lon, v.largura, w, h]}" alt="${esc(alt)}" loading="lazy" width="${w}" height="${h}">` +
    `<i style="width:${d}px;height:${d}px"></i></span>`;
}

// ------------------------------------------------------------------ gráficos

// linhas com rótulo no fim de cada série (com linha-guia quando precisa desviar) e cursor vertical com dica.
// Opções: ref (linha de referência), detalhe(s, i) (texto extra da série na dica). Valores null deixam a série
// com lacuna. O eixo y sempre começa no zero.
function grafLinhas(box, xs, series, o = {}) {
  const { rotuloX = x => String(x), casas = 0, sufixo = "", unidade = "", H = 270, rotulo = "", ref = null, detalhe = null } = o;
  box.innerHTML = "";
  box.appendChild(legendaSerie(series));
  const W = Math.max(280, box.clientWidth);
  const ultimo = s => s.valores.findLastIndex(v => v != null);
  const fins = series.map(s => { const i = ultimo(s); return { s, i, v: s.valores[i], t1: fmt(s.valores[i], casas) + sufixo, t2: s.nome }; });
  const larguraRot = f => 16 + larguraTexto(f.t1, 12, 650) + 5 + larguraTexto(f.t2, 12);
  const noFim = fins.filter(f => f.i === xs.length - 1);
  const dirRot = noFim.length ? Math.max(...noFim.map(larguraRot)) : 10;
  const comRotulos = W - dirRot > 300;  // em telas estreitas, legenda e dica bastam
  const dir = comRotulos ? dirRot : 10;
  const vals = series.flatMap(s => s.valores).filter(v => v != null);
  const { passo, topo: maxY } = escalaBonita(Math.max(...vals, ref ?? -Infinity));
  const cp = casasDoPasso(passo);
  const esq = 10 + larguraTexto(fmt(maxY, cp), 11), cima = 10, base = 26;
  const svg = novoSvg(W, H, rotulo);
  const larg = W - esq - dir, alt = H - cima - base;
  const X = i => esq + i * larg / (xs.length - 1);
  const Y = v => cima + alt * (1 - v / maxY);
  for (let v = 0; v <= maxY + 1e-9; v += passo) {
    const destaque = v === 0 || (ref != null && Math.abs(v - ref) < 1e-9);
    svg.appendChild(svgEl("line", { x1: esq, x2: W - dir + 4, y1: Y(v), y2: Y(v), stroke: destaque ? COR.eixo : COR.grade }));
    svg.appendChild(txt({ x: esq - 7, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: COR.mudo }, fmt(v, cp)));
  }
  const lx = Math.max(...xs.map(x => larguraTexto(rotuloX(x), 11))) + 12;
  const cada = Math.max(1, Math.ceil(lx / (larg / (xs.length - 1))));
  xs.forEach((x, i) => { if (i % cada === 0)
    svg.appendChild(txt({ x: X(i), y: H - 7, "text-anchor": "middle", "font-size": 11, fill: COR.mudo }, rotuloX(x))); });
  series.forEach(s => {
    const d = s.valores.map((v, i) => v == null ? "" : `${i && s.valores[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: s.cor, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const i = ultimo(s);
    svg.appendChild(svgEl("circle", { cx: X(i), cy: Y(s.valores[i]), r: 4, fill: s.cor, stroke: "#fff", "stroke-width": 2 }));
  });
  // séries que terminam antes do fim levam o rótulo ao lado do último ponto; as demais, empilhadas na margem
  if (comRotulos) {
    rotulosFim(svg, noFim, Y, X(xs.length - 1), H - base);
    fins.filter(f => f.i < xs.length - 1).forEach(f => rotulosFim(svg, [f], Y, X(f.i), H - base));
  }
  // cursor
  const guia = svgEl("line", { y1: cima, y2: H - base, stroke: COR.mudo, "stroke-width": 1, visibility: "hidden" });
  const pontos = series.map(s => svgEl("circle", { r: 4, fill: s.cor, stroke: "#fff", "stroke-width": 2, visibility: "hidden" }));
  svg.appendChild(guia); pontos.forEach(p => svg.appendChild(p));
  const area = svgEl("rect", { x: esq, y: 0, width: larg + 8, height: H - base + 4, fill: "transparent" });
  area.addEventListener("pointermove", ev => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(xs.length - 1, Math.round((ev.clientX - r.left - esq) / (larg / (xs.length - 1)))));
    guia.setAttribute("x1", X(i)); guia.setAttribute("x2", X(i)); guia.setAttribute("visibility", "visible");
    pontos.forEach((p, k) => {
      const v = series[k].valores[i];
      if (v == null) { p.setAttribute("visibility", "hidden"); return; }
      p.setAttribute("cx", X(i)); p.setAttribute("cy", Y(v)); p.setAttribute("visibility", "visible");
    });
    mostraDica(ev, `<div class="t">${rotuloX(xs[i], true)}</div>` + series.filter(s => s.valores[i] != null)
      .sort((a, b) => b.valores[i] - a.valores[i])
      .map(s => linhaDica(s.cor, fmt(s.valores[i], casas) + sufixo, s.nome + unidade) +
        (detalhe ? `<div class="sub">${detalhe(s, i)}</div>` : "")).join(""));
  });
  area.addEventListener("pointerleave", () => { guia.setAttribute("visibility", "hidden"); pontos.forEach(p => p.setAttribute("visibility", "hidden")); escondeDica(); });
  svg.appendChild(area);
  box.appendChild(svg);
}

// rótulos no fim das linhas: afastados ao menos 15 px; os deslocados ganham uma linha-guia até o ponto
function rotulosFim(svg, fins, Y, xf, limite) {
  if (!fins.length) return;
  fins.forEach(f => { f.y0 = Y(f.v); f.y = f.y0; });
  const ord = [...fins].sort((a, b) => a.y - b.y);
  for (let i = 1; i < ord.length; i++) if (ord[i].y - ord[i - 1].y < 15) ord[i].y = ord[i - 1].y + 15;
  const excesso = ord.at(-1).y - limite;
  if (excesso > 0) ord.forEach(f => { f.y -= excesso; });
  for (let i = ord.length - 2; i >= 0; i--) if (ord[i + 1].y - ord[i].y < 15) ord[i].y = ord[i + 1].y - 15;
  const xl = xf + 14;
  fins.forEach(f => {
    if (Math.abs(f.y - f.y0) > 2)
      svg.appendChild(svgEl("path", { d: `M${xf + 6},${f.y0}L${xl - 3},${f.y}`, stroke: COR.eixo, "stroke-width": 1, fill: "none" }));
    const t = txt({ x: xl, y: f.y + 4, "font-size": 12, fill: COR.tinta }, "");
    t.appendChild(Object.assign(svgEl("tspan", { "font-weight": 650 }), { textContent: f.t1 }));
    t.appendChild(Object.assign(svgEl("tspan", { fill: COR.tinta2, dx: 5 }), { textContent: f.t2 }));
    svg.appendChild(t);
  });
}

// pequenos múltiplos: idade das vítimas fatais, um painel por modo, mesma escala
function grafIdade(box, faixas, grupos) {
  box.innerHTML = "";
  const grade = el("div", { className: "multiplos" });
  box.appendChild(grade);
  const { passo, topo } = escalaBonita(Math.max(...grupos.flatMap(g => g.valores)), 5);
  const empilhado = getComputedStyle(grade).gridTemplateColumns.trim().split(/\s+/).length === 1;
  grupos.forEach((g, k) => {
    const cel = el("div", {}, `<h4><i style="background:${g.cor}"></i>${esc(g.nome)}</h4>`);
    grade.appendChild(cel);
    const W = Math.max(220, cel.clientWidth), comEixo = k === 0 || empilhado;
    const H = empilhado ? 160 : 190, esq = comEixo ? 32 : 4, dir = 2, cima = 18, base = 22;
    const svg = novoSvg(W, H, `Idade das vítimas fatais: ${g.nome}`);
    const Y = v => cima + (H - cima - base) * (1 - v / topo);
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      svg.appendChild(svgEl("line", { x1: esq, x2: W - dir, y1: Y(v), y2: Y(v), stroke: v === 0 ? COR.eixo : COR.grade }));
      if (comEixo) svg.appendChild(txt({ x: esq - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 10.5, fill: COR.mudo }, v + "%"));
    }
    const bw = (W - esq - dir) / faixas.length, w = Math.min(24, bw * 0.7);
    const iMax = g.valores.indexOf(Math.max(...g.valores));
    faixas.forEach((f, j) => {
      const v = g.valores[j], x = esq + j * bw + (bw - w) / 2;
      svg.appendChild(svgEl("path", { d: barraV(x, Y(v), w, Y(0) - Y(v), 4), fill: g.cor }));
      if (j === iMax) svg.appendChild(txt({ x: x + w / 2, y: Y(v) - 5, "text-anchor": "middle", "font-size": 11.5, "font-weight": 650, fill: COR.tinta }, fmt(v) + "%"));
      svg.appendChild(txt({ x: esq + j * bw + bw / 2, y: H - 6, "text-anchor": "middle", "font-size": 10, fill: COR.mudo }, f));
      const alvo = svgEl("rect", { x: esq + j * bw, y: cima, width: bw, height: H - cima - base, fill: "transparent" });
      comDica(alvo, `<div class="t">${esc(g.nome)}, ${f} anos</div>${linhaDica(g.cor, fmt(v, 1) + "%", "das mortes do grupo", true)}`);
      svg.appendChild(alvo);
    });
    cel.appendChild(svg);
  });
}

// pontos pareados por linha (ex.: letalidade nas rodovias e nas vias urbanas, por tipo de sinistro), com os valores
// numa coluna à direita de cada série. itens: [{ nome, valores: [v1, v2], dica }]; series: [{ nome, cor }]
function grafPares(box, itens, series, o = {}) {
  const { casas = 1, rotulo = "" } = o;
  box.innerHTML = "";
  box.appendChild(legendaSerie(series, "bloco"));
  const W = Math.max(280, box.clientWidth);
  const empilhado = W < 560;  // em telas estreitas, o nome vai numa linha acima dos pontos
  const col = 62, dir = series.length * col;
  const esq = empilhado ? 4 : 14 + Math.max(...itens.map(it => larguraTexto(it.nome, 13)));
  const linha = empilhado ? 50 : 34, cima = 22, base = 22, H = cima + itens.length * linha + base;
  const { passo, topo } = escalaBonita(Math.max(...itens.flatMap(it => it.valores.filter(v => v != null))), empilhado ? 3 : 5);
  const cp = casasDoPasso(passo);
  const svg = novoSvg(W, H, rotulo);
  const x0 = esq, x1 = W - dir - 14;
  const X = v => x0 + (x1 - x0) * v / topo;
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    svg.appendChild(svgEl("line", { x1: X(v), x2: X(v), y1: cima - 4, y2: H - base, stroke: v === 0 ? COR.eixo : COR.grade }));
    svg.appendChild(txt({ x: X(v), y: H - 6, "text-anchor": "middle", "font-size": 11, fill: COR.mudo }, fmt(v, cp)));
  }
  series.forEach((s, k) => svg.appendChild(txt({ x: W - dir + k * col + col - 2, y: 12, "text-anchor": "end", "font-size": 11, "font-weight": 600, fill: COR.tinta2 }, s.curto || s.nome)));
  itens.forEach((it, j) => {
    const y = cima + j * linha + (empilhado ? 32 : linha / 2);
    if (empilhado) svg.appendChild(txt({ x: esq, y: y - 13, "font-size": 12.5, fill: COR.tinta }, it.nome));
    else svg.appendChild(txt({ x: esq - 12, y: y + 4.5, "text-anchor": "end", "font-size": 13, fill: COR.tinta }, it.nome));
    const vs = it.valores.filter(v => v != null);
    if (vs.length === 2) svg.appendChild(svgEl("line", { x1: X(Math.min(...vs)), x2: X(Math.max(...vs)), y1: y, y2: y, stroke: COR.eixo, "stroke-width": 2 }));
    it.valores.forEach((v, k) => {
      if (v != null) svg.appendChild(svgEl("circle", { cx: X(v), cy: y, r: 5.5, fill: series[k].cor, stroke: "#fff", "stroke-width": 2 }));
      svg.appendChild(txt({ x: W - dir + k * col + col - 2, y: y + 4.5, "text-anchor": "end", "font-size": 12.5, "font-weight": k === 0 ? 650 : 400,
        fill: COR.tinta }, v == null ? "—" : fmt(v, casas)));
    });
    const alvo = svgEl("rect", { x: 0, y: cima + j * linha, width: W, height: linha, fill: "transparent" });
    comDica(alvo, it.dica);
    svg.appendChild(alvo);
  });
  box.appendChild(svg);
}

// barras horizontais de um painel; linhas: [{ nome, v, dica }]. Valores null aparecem como "—".
function barrasH(cel, linhas, o) {
  const { cor, casas = 0, sufixo = "", comNomes = true, rotulo = "" } = o;
  const W = Math.max(200, cel.clientWidth), linha = 34, cima = 4, H = cima + linhas.length * linha;
  const esq = comNomes ? 12 + Math.max(...linhas.map(l => larguraTexto(l.nome, 13))) : 4;
  const rot = l => l.v == null ? "—" : fmt(l.v, casas) + sufixo;
  const dir = 10 + Math.max(...linhas.map(l => larguraTexto(rot(l), 12.5, 650)));
  const max = Math.max(...linhas.map(l => l.v ?? 0)) || 1;
  const X = v => esq + (W - esq - dir) * v / max;
  const svg = novoSvg(W, H, rotulo);
  svg.appendChild(svgEl("line", { x1: esq, x2: esq, y1: cima, y2: H, stroke: COR.eixo }));
  linhas.forEach((l, i) => {
    const y = cima + i * linha, yb = y + 9;
    if (comNomes) svg.appendChild(txt({ x: esq - 10, y: yb + 12, "text-anchor": "end", "font-size": 13, fill: COR.tinta }, l.nome));
    if (l.v != null) svg.appendChild(svgEl("path", { d: barraH(esq, yb, X(l.v) - esq, 16, 4), fill: cor }));
    svg.appendChild(txt({ x: (l.v != null ? X(l.v) : esq) + 7, y: yb + 12.5, "font-size": 12.5, "font-weight": 650, fill: l.v == null ? COR.mudo : COR.tinta }, rot(l)));
    const alvo = svgEl("rect", { x: 0, y, width: W, height: linha, fill: "transparent" });
    comDica(alvo, l.dica);
    svg.appendChild(alvo);
  });
  cel.appendChild(svg);
}

// dois painéis de barras lado a lado, com as mesmas linhas (os nomes só no primeiro, salvo quando empilham)
function grafDoisPaineis(box, paineis) {
  box.innerHTML = "";
  const grade = el("div", { className: "multiplos dois" });
  box.appendChild(grade);
  const empilhado = getComputedStyle(grade).gridTemplateColumns.trim().split(/\s+/).length === 1;
  paineis.forEach((p, k) => {
    const cel = el("div", {}, `<h4>${esc(p.titulo)}</h4>`);
    grade.appendChild(cel);
    barrasH(cel, p.linhas, { ...p, comNomes: k === 0 || empilhado });
  });
}

// linha pequena sobre fundo escuro (número de destaque da capa)
function sparkline(box, anos, valores, iMin) {
  box.innerHTML = "";
  const W = Math.max(200, box.clientWidth), H = 92, esq = 4, dir = 4, cima = 22, base = 18;
  const svg = novoSvg(W, H, "Mortes por ano no estado");
  const max = Math.max(...valores);
  const X = i => esq + i * (W - esq - dir) / (anos.length - 1);
  const Y = v => cima + (H - cima - base) * (1 - v / max);  // eixo no zero: a altura é proporcional às mortes
  const d = valores.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  svg.appendChild(svgEl("path", { d: `${d}L${X(anos.length - 1)},${H - base}L${X(0)},${H - base}Z`, fill: "#ffffff", "fill-opacity": 0.07 }));
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: "#ffffff", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const marca = (i, ancora) => {
    svg.appendChild(svgEl("circle", { cx: X(i), cy: Y(valores[i]), r: 4, fill: i === anos.length - 1 ? COR.sin : "#fff", stroke: COR.tinta, "stroke-width": 2 }));
    svg.appendChild(txt({ x: X(i), y: Y(valores[i]) + (i === iMin ? 17 : -10), "text-anchor": ancora, "font-size": 11.5, "font-weight": 600, fill: "#fff" }, fmt(valores[i])));
  };
  marca(iMin, "middle"); marca(anos.length - 1, "end");
  [0, anos.length - 1].forEach(i => svg.appendChild(txt({ x: X(i), y: H - 2, "text-anchor": i ? "end" : "start", "font-size": 11, fill: "#9aa1ab" }, anos[i])));
  if (iMin > 0 && iMin < anos.length - 1)
    svg.appendChild(txt({ x: X(iMin), y: H - 2, "text-anchor": "middle", "font-size": 11, fill: "#9aa1ab" }, anos[iMin]));
  anos.forEach((a, i) => {
    const alvo = svgEl("rect", { x: X(i) - (W / anos.length) / 2, y: 0, width: W / anos.length, height: H, fill: "transparent" });
    comDica(alvo, `<div class="t">${a}</div><b>${fmt(valores[i])}</b> mortes`);
    svg.appendChild(alvo);
  });
  box.appendChild(svg);
}

// barras horizontais do município com a marca do estado
function grafQuem(box, itens) {
  box.innerHTML = "";
  if (!itens.length) { box.appendChild(el("p", { className: "nota", textContent: `Sem mortes registradas ${periodo().texto}.` })); return; }
  box.appendChild(el("div", { className: "legenda-serie" }, `<span><i class="bloco" style="background:${COR.mudo}"></i>município</span><span><i class="marca" style="background:${COR.tinta}"></i>estado</span>`));
  const W = Math.max(260, box.clientWidth), linha = 44;
  const esq = 12 + Math.max(...itens.map(i => larguraTexto(NOME_MODO[i.nome], 13))), dir = 46, H = itens.length * linha;
  const svg = novoSvg(W, H, "Mortes por modo de deslocamento: município e estado");
  const max = Math.max(...itens.flatMap(i => [i.mun, i.est])) * 1.02 || 1;
  const X = v => esq + (W - esq - dir) * v / max;
  svg.appendChild(svgEl("line", { x1: esq, x2: esq, y1: 4, y2: H - 4, stroke: COR.eixo }));
  itens.forEach((it, i) => {
    const y = i * linha, yb = y + 14;
    svg.appendChild(txt({ x: esq - 10, y: yb + 12, "text-anchor": "end", "font-size": 13, fill: COR.tinta }, NOME_MODO[it.nome]));
    svg.appendChild(svgEl("path", { d: barraH(esq, yb, X(it.mun) - esq, 16, 4), fill: COR_MODO[it.nome] }));
    svg.appendChild(svgEl("line", { x1: X(it.est), x2: X(it.est), y1: yb - 5, y2: yb + 21, stroke: COR.tinta, "stroke-width": 2, "stroke-linecap": "round" }));
    svg.appendChild(txt({ x: Math.max(X(it.mun), X(it.est)) + 7, y: yb + 12.5, "font-size": 12.5, fill: COR.tinta, "font-weight": 650 }, fmt(it.mun) + "%"));
    const alvo = svgEl("rect", { x: 0, y, width: W, height: linha, fill: "transparent" });
    comDica(alvo, `<div class="t">${NOME_MODO[it.nome]}</div>${linhaDica(COR_MODO[it.nome], fmt(it.mun) + "%", `das mortes no município (${plural(it.n, "morte", "mortes")})`, true)}` +
      `<div class="l"><i style="background:${COR.tinta};width:2px;height:12px"></i><b>${fmt(it.est)}%</b><span class="s">no estado</span></div>`);
    svg.appendChild(alvo);
  });
  box.appendChild(svg);
}

function horaDia(m) {
  const box = $("hora-dia");
  box.innerHTML = "";
  const mortes = st.hora === "m", P = periodo();
  const dados = Array.from({ length: 7 }, () => new Array(24).fill(0));
  m.por_ano.hora_dia.forEach(([i, d, h, n, mo]) => { if (i >= P.idx[0] && i <= P.idx[1]) dados[d][h] += mortes ? mo : n; });
  $("sub-hora").textContent = (mortes ? "mortes" : "sinistros com vítimas") + " " + P.texto;
  const W = Math.max(260, box.clientWidth), esq = 32, cima = 18, cel = 24, H = cima + 7 * cel;
  const svg = novoSvg(W, H, `Dia da semana e hora: ${mortes ? "mortes" : "sinistros com vítimas"}`);
  const cw = (W - esq) / 24;
  const q = quebras(dados.flat().filter(v => v > 0), mortes ? 5 : 7);
  const cores = rampa(mortes ? AMEIXA : CALOR, q.length + 1);
  dados.forEach((linhaD, d) => {
    svg.appendChild(txt({ x: esq - 7, y: cima + d * cel + cel / 2 + 4, "text-anchor": "end", "font-size": 11, fill: COR.tinta2 }, DIAS[d]));
    linhaD.forEach((v, h) => {
      const r = svgEl("rect", { x: esq + h * cw + 1, y: cima + d * cel + 1, width: Math.max(1, cw - 2), height: cel - 2, rx: 3,
        fill: v === 0 ? COR.vazio : cores[classe(v, q)] });
      comDica(r, `<div class="t">${DIAS_LONGOS[d]}, ${h}h–${h}h59</div>${mortes ? plural(v, "morte", "mortes") : plural(v, "sinistro com vítimas", "sinistros com vítimas")}`);
      svg.appendChild(r);
    });
  });
  const cadaH = cw < 13 ? 6 : 3;
  for (let h = 0; h < 24; h += cadaH)
    svg.appendChild(txt({ x: esq + h * cw + cw / 2, y: cima - 6, "text-anchor": "middle", "font-size": 10.5, fill: COR.mudo }, h + "h"));
  box.appendChild(svg);
  const leg = el("div", { className: "legenda" });
  leg.appendChild(legendaEscala(cores, q));
  leg.appendChild(el("span", { className: "item-leg", textContent: mortes ? "mortes por hora" : "sinistros por hora" }));
  box.appendChild(leg);
}

// barras por ano; destaque = [primeiro, último ano]: os anos fora dele ficam esmaecidos
function serie(box, titulo, anos, valores, cor, destaque = null) {
  box.innerHTML = "";
  const fim = new Date(st.estado.atualizacao + "T12:00:00"), mesFim = fim.getMonth() + 1;
  const ultimo = anos.at(-1), parcialUlt = ultimo === fim.getFullYear() && mesFim < 12;
  box.appendChild(el("div", { className: "legenda-serie" }, `<span><i class="bloco" style="background:${cor}"></i>${esc(titulo)}</span>` +
    (parcialUlt ? `<span style="color:${COR.mudo};margin-left:auto">* ${ultimo}: até ${MESES[mesFim - 1]}</span>` : "")));
  const W = Math.max(260, box.clientWidth), H = 132, cima = 18, base = 20;
  const svg = novoSvg(W, H, `${titulo} por ano`);
  const max = Math.max(1, ...valores);
  const bw = W / anos.length, ah = H - cima - base, w = Math.min(24, bw * 0.66);
  const cada = bw < 30 ? 2 : 1;
  svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: cima + ah, y2: cima + ah, stroke: COR.eixo }));
  anos.forEach((a, i) => {
    const v = valores[i], h = ah * v / max, parcial = a === ultimo && parcialUlt;
    const fora = destaque && (a < destaque[0] || a > destaque[1]);
    const x = i * bw + (bw - w) / 2;
    svg.appendChild(svgEl("path", { d: barraV(x, cima + ah - h, w, h, 4), fill: cor, "fill-opacity": fora ? 0.25 : parcial && !destaque ? 0.4 : 1 }));
    if ((anos.length - 1 - i) % cada === 0)
      svg.appendChild(txt({ x: x + w / 2, y: H - 5, "text-anchor": "middle", "font-size": 10.5, fill: COR.mudo }, parcial ? a + "*" : String(a)));
    if (v === max || i === anos.length - 1 - (parcialUlt ? 1 : 0))
      svg.appendChild(txt({ x: x + w / 2, y: cima + ah - h - 5, "text-anchor": "middle", "font-size": 11, "font-weight": 600, fill: COR.tinta2 }, fmt(v)));
    const alvo = svgEl("rect", { x: i * bw, y: 0, width: bw, height: H, fill: "transparent" });
    comDica(alvo, `<div class="t">${parcial ? `${a} (até ${MESES[mesFim - 1]})` : a}</div>${linhaDica(cor, fmt(v), titulo.toLowerCase(), true)}`);
    svg.appendChild(alvo);
  });
  box.appendChild(svg);
}

// ------------------------------------------------------------------ estado: capa e histórias

function totaisEstado() {
  const e = st.estado, p = e.panorama, anos = p.anos_mortes;
  const mesFim = new Date(e.atualizacao + "T12:00:00").getMonth() + 1;
  const nComp = mesFim < 12 ? anos.length - 1 : anos.length;  // só anos completos
  const total = anos.map((_, i) => Object.values(p.mortes_modo).reduce((a, s) => a + s[i], 0));
  const comp = total.slice(0, nComp);
  return { anos, nComp, total, comp, iU: nComp - 1, iMin: comp.indexOf(Math.min(...comp)), mesFim };
}

function capa() {
  const e = st.estado, t = totaisEstado();
  const alta = 100 * (t.total[t.iU] / t.total[t.iMin] - 1);
  const box = $("hero-numero");
  box.innerHTML = `<p class="rotulo-topo">Mortes no trânsito em ${t.anos[t.iU]}</p>
    <div class="valor">${fmt(t.total[t.iU])}</div>
    <p class="valor-sub">em todo o estado, cerca de ${fmt(t.total[t.iU] / 365)} por dia</p>
    ${t.iMin < t.iU ? `<span class="faixa">▲ ${fmt(alta)}% desde ${t.anos[t.iMin]}</span>` : ""}
    <div class="spark" id="spark"></div>
    <p class="nota-hero">Mortes por ano, ${t.anos[0]} a ${t.anos[t.iU]}; o menor número foi em ${t.anos[t.iMin]}.` +
    (t.nComp < t.anos.length ? ` Em ${t.anos.at(-1)}, até ${MESES[t.mesFim - 1]}: ${fmt(t.total.at(-1))}.` : "") + `</p>`;

  const at = $("atalhos");
  [...e.municipios].sort((a, b) => b.pop - a.pop).slice(0, 5).forEach(m => at.appendChild(el("a", { href: "#" + m.cod, textContent: m.nome })));
}

// mortes por 100 sinistros; variação percentual; "em 2018 e de 2022 a 2025"
const letal = x => x && x.n ? 100 * x.m / x.n : null;
const varPct = (a, b) => 100 * (b / a - 1);
const comSinal = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v));
function faixasDeAnos(anos) {
  const g = [];
  anos.forEach(a => { const u = g.at(-1); if (u && a === u[1] + 1) u[1] = a; else g.push([a, a]); });
  const t = g.map(([a, b]) => a === b ? `em ${a}` : `de ${a} a ${b}`);
  return t.length > 1 ? t.slice(0, -1).join(", ") + " e " + t.at(-1) : t[0] || "";
}
// frota de motos e demais mortes ao lado das mortes de motociclistas (azul): cinzas validados contra o azul
const COR_FROTA = "#4a515b", COR_OUTRAS = "#a9adb3";
const SERIES_VIA = [{ nome: "Rodovias", cor: COR.mortes }, { nome: "Vias urbanas", curto: "Urbanas", cor: COR.urbana }];

// números derivados das análises de letalidade, frota e SIM, usados nos textos e nos gráficos
function derivados() {
  const p = st.estado.panorama;
  const mf = p.motos_frota, u = mf.anos.length - 1;
  const lv = p.letalidade_velocidade;
  const letV = k => lv.classes.map((_, i) => lv[k].n[i] >= lv.min_n ? 100 * lv[k].m[i] / lv[k].n[i] : null);
  const sim = p.sim;
  const razao = k => sim.anos.map((_, i) => 100 * sim[k].sim[i] / sim[k].infosiga[i]);
  const razCap = razao("capital"), razDem = razao("demais");
  // anos em que o SIM registra bem menos que o Infosiga na capital
  const baixos = sim.anos.filter((_, i) => razCap[i] < 60);
  const soma = (k, campo, anos) => sim.anos.reduce((a, ano, i) => a + (anos.includes(ano) ? sim[k][campo][i] : 0), 0);
  const ultimosFinais = sim.anos.filter(a => !sim.preliminar.includes(a)).at(-1);
  const iF = sim.anos.indexOf(ultimosFinais);
  return {
    mf, u, taxaMoto: i => 1e4 * mf.mortes_moto[i] / mf.frota_motos[i],
    velU: letV("urbana"), velR: letV("rodovia"), lv,
    razCap, razDem, baixos,
    capBaixos: 100 * soma("capital", "sim", baixos) / soma("capital", "infosiga", baixos),
    demBaixos: 100 * soma("demais", "sim", baixos) / soma("demais", "infosiga", baixos),
    indetCap: sim.capital.pct_indet[iF], indetDem: sim.demais.pct_indet[iF], anoIndet: ultimosFinais,
  };
}

function historias() {
  const e = st.estado, p = e.panorama, t = totaisEstado(), d = derivados();
  const fimTaxa = e.anos_taxa[1];
  const pctModo = (k, i) => 100 * p.mortes_modo[k][i] / t.total[i];
  const lv = p.letalidade_via, lh = p.letalidade_hora;
  const pico = s => s.indexOf(Math.max(...s));
  const madrugada = pico(lh["Rodovias"]) < 6 && pico(lh["Vias urbanas"]) < 6;

  // frota de motos
  const mf = d.mf, a0 = mf.anos[0], aU = mf.anos[d.u];
  const cFrota = varPct(mf.frota_motos[0], mf.frota_motos[d.u]), cMortes = varPct(mf.mortes_moto[0], mf.mortes_moto[d.u]);
  const cTaxa = varPct(d.taxaMoto(0), d.taxaMoto(d.u)), cOutras = varPct(mf.mortes_outras[0], mf.mortes_outras[d.u]);
  const risco = Math.abs(cTaxa) < 10 ? "mudou pouco" : cTaxa > 0 ? `subiu ${fmt(cTaxa)}%` : `caiu ${fmt(-cTaxa)}%`;

  // quem atinge os pedestres
  const at = p.atropeladores, tipo = k => at.tipos.find(x => x.tipo === k);
  const on = tipo("Ônibus"), au = tipo("Automóvel");

  // tipos de sinistro
  const lt = p.letalidade_tipo.itens, porTipo = k => lt.find(x => x.tipo === k);
  const artigo = n => (n.startsWith("Colisão") ? "a " : "o ") + n[0].toLowerCase() + n.slice(1);
  const urbMais = [...lt].filter(x => x.urbana).sort((a, b) => letal(b.urbana) - letal(a.urbana)).slice(0, 2);

  // limite de velocidade
  const iC = c => d.lv.classes.indexOf(c);
  const u50 = d.velU[iC("50")], u60 = d.velU[iC("60")];
  const rIdx = d.velR.map((v, i) => v == null ? null : i).filter(i => i != null);
  const rIni = rIdx[0], rFim = rIdx.at(-1);

  const itens = [
    { box: "historias", id: "graf-modo", grande: `${fmt(pctModo("Motocicleta", t.iU))}%`,
      texto: `<b>das mortes em ${t.anos[t.iU]} foram de motociclistas.</b> Em ${t.anos[0]} eram ${fmt(pctModo("Motocicleta", 0))}%. ` +
        `Foram ${fmt(p.mortes_modo["Motocicleta"][t.iU])} motociclistas mortos em ${t.anos[t.iU]}, contra ${fmt(p.mortes_modo["Motocicleta"][0])} em ${t.anos[0]}.`,
      titulo: "Mortes por modo de deslocamento da vítima", sub: `por ano, ${t.anos[0]} a ${t.anos[t.iU]}` },
    { box: "historias", id: "graf-frota", grande: `${comSinal(cFrota)}%`,
      texto: `<b>foi o crescimento da frota de motos do estado de ${a0} a ${aU}.</b> No mesmo período, as mortes de motociclistas ` +
        `${cMortes >= 0 ? "subiram" : "caíram"} ${fmt(Math.abs(cMortes))}%. Por moto, o risco ${risco}: ${fmt(d.taxaMoto(0), 1)} mortes por 10 mil motos ` +
        `em ${a0} e ${fmt(d.taxaMoto(d.u), 1)} em ${aU}. As demais mortes ${cOutras >= 0 ? "subiram" : "caíram"} ${fmt(Math.abs(cOutras))}%.`,
      titulo: "Frota de motos e mortes no trânsito", sub: `índice, ${a0} = 100; frota registrada em dezembro de cada ano (Senatran)` },
    { box: "historias", id: "graf-idade", grande: `${fmt(p.moto_jovem.pct_18_29)}%`,
      texto: `<b>dos motociclistas mortos tinham de 18 a 29 anos</b>, e ${fmt(p.moto_jovem.pct_homem)}% eram homens. ` +
        `Entre os pedestres mortos, ${fmt(p.ped_idoso)}% tinham 60 anos ou mais.`,
      titulo: "Idade das vítimas fatais", sub: `% das mortes de cada grupo, ${e.anos_taxa[0]} a ${fimTaxa}` },
    { box: "historias", id: "graf-atropela", grande: `${fmt(on.por_100mil / au.por_100mil)}<small>vezes</small>`,
      texto: `<b>mais pedestres são mortos por ônibus que por automóveis, para o tamanho de cada frota</b>: ${fmt(on.por_100mil, 1)} por ano ` +
        `para cada 100 mil ônibus, contra ${fmt(au.por_100mil, 1)} para cada 100 mil automóveis. Parte da diferença vem de os ônibus rodarem muito mais, ` +
        `e em ruas com mais pedestres. Em números absolutos, os automóveis lideram: atingiram ${fmt(au.pct)}% dos pedestres mortos.`,
      titulo: "Quem atinge os pedestres mortos",
      sub: `sinistros com um único veículo (${fmt(at.pct_um_veiculo)}% das mortes de pedestres), ${e.ano_ini} a ${fimTaxa}` },

    { box: "historias-letalidade", id: "graf-letal", grande: `${fmt(lv.rodovia / lv.urbana, 1)}<small>vezes</small>`,
      texto: `<b>mais letal é um sinistro nas rodovias que nas vias urbanas</b>: ${fmt(lv.rodovia, 1)} mortes por 100 sinistros com vítimas, contra ${fmt(lv.urbana, 1)}.` +
        (madrugada ? " Nos dois casos, a letalidade é maior de madrugada." : ""),
      titulo: "Letalidade por hora do dia", sub: `mortes por 100 sinistros com vítimas, ${e.ano_ini} a ${fimTaxa}` },
    { box: "historias-letalidade", id: "graf-tipo", grande: fmt(letal(porTipo("Atropelamento de pedestre").rodovia)),
      texto: `<b>mortes a cada 100 atropelamentos de pedestres nas rodovias</b>, e ${fmt(letal(porTipo("Colisão frontal").rodovia))} a cada 100 colisões frontais. ` +
        `Nas vias urbanas, os tipos mais letais são ${artigo(urbMais[0].tipo)} (${fmt(letal(urbMais[0].urbana))} mortes por 100) e ${artigo(urbMais[1].tipo)} (${fmt(letal(urbMais[1].urbana))}).`,
      titulo: "Letalidade por tipo de sinistro", sub: `mortes por 100 sinistros com vítimas de cada tipo, ${e.ano_ini} a ${fimTaxa}`,
      nota: `${fmt(p.letalidade_tipo.pct_sem_tipo)}% dos sinistros com vítimas não têm tipo definido e ficam de fora; um sinistro pode ter mais de um tipo. O Infosiga não registra colisões traseiras.` },
    { box: "historias-letalidade", id: "graf-vel",
      grande: u50 && u60 ? `${comSinal(varPct(u50, u60))}%` : "—",
      texto: (u50 && u60 ? `<b>mais letal é um atropelamento numa via urbana com limite de 60 km/h que numa de 50 km/h</b>: ` +
        `${fmt(u60, 1)} mortes por 100 atropelamentos com vítimas, contra ${fmt(u50, 1)}. ` : "") +
        (rIdx.length > 1 ? `Nas rodovias, a letalidade dos atropelamentos vai de ${fmt(d.velR[rIni])} (${d.lv.classes[rIni]} km/h) a ${fmt(d.velR[rFim])} (${d.lv.classes[rFim]} km/h).` : ""),
      titulo: "Atropelamentos por limite de velocidade da via", sub: `mortes por 100 atropelamentos com vítimas, ${e.ano_ini} a ${fimTaxa}; limite em km/h`,
      nota: `Limite do OpenStreetMap, conhecido em ${fmt(d.lv.cobertura)}% dos atropelamentos com local preciso. Ficam de fora as combinações com menos de ${fmt(d.lv.min_n)} atropelamentos.` },

    { box: "historias-contagens", id: "graf-sim", grande: fmt(d.capBaixos),
      texto: `<b>mortes por acidente de transporte na capital registra o SIM, do Ministério da Saúde, para cada 100 mortes no trânsito contadas pelo Infosiga</b>, ` +
        `${faixasDeAnos(d.baixos)}. Nos demais municípios, as duas contagens ficam próximas (${fmt(d.demBaixos)} para cada 100). ` +
        `Em ${d.anoIndet}, o SIM registrou com intenção indeterminada ${fmt(d.indetCap)}% das mortes por causas externas na capital, ` +
        `sem dizer se foi trânsito, queda ou agressão; nos demais municípios, ${fmt(d.indetDem)}%.`,
      titulo: "Mortes no SIM para cada 100 no Infosiga",
      sub: `acidentes de transporte terrestre (CID-10 V01–V89) pelo local do óbito` +
        (p.sim.preliminar.length ? `; ${p.sim.preliminar.join(", ")}*: dados preliminares do SIM` : "") },
  ];
  itens.forEach(it => $(it.box).appendChild(el("article", { className: "historia cartao" },
    `<div class="historia-texto"><div class="grande">${it.grande}</div><p>${it.texto}</p></div>
     <figure><figcaption><h3>${it.titulo}</h3><p>${it.sub}</p></figcaption><div class="grafico" id="${it.id}"></div>` +
    (it.nota ? `<p class="nota nota-graf">${it.nota}</p>` : "") + `</figure>`)));
}

function desenhaGraficosEstado() {
  const p = st.estado.panorama, t = totaisEstado(), d = derivados();
  sparkline($("spark"), t.anos.slice(0, t.nComp), t.comp, t.iMin);
  const xs = t.anos.slice(0, t.nComp);
  grafLinhas($("graf-modo"), xs, GRUPOS_MODO.map(([k, ks]) => ({
    nome: NOME_MODO[k], cor: COR_MODO[k],
    valores: xs.map((_, i) => ks.reduce((a, c) => a + p.mortes_modo[c][i], 0)) })),
    { rotulo: "Mortes por modo de deslocamento, por ano" });

  const mf = d.mf, indice = v => v.map(x => 100 * x / v[0]);
  const frota = [
    { nome: "Motociclistas mortos", cor: COR_MODO["Motocicleta"], valores: indice(mf.mortes_moto), det: mf.mortes_moto.map(n => plural(n, "morte", "mortes")) },
    { nome: "Frota de motos", cor: COR_FROTA, valores: indice(mf.frota_motos), det: mf.frota_motos.map(n => `${fmt(n / 1e6, 2)} milhões de motos`) },
    { nome: "Demais mortes", cor: COR_OUTRAS, valores: indice(mf.mortes_outras), det: mf.mortes_outras.map(n => plural(n, "morte", "mortes")) },
  ];
  grafLinhas($("graf-frota"), mf.anos, frota, { ref: 100, detalhe: (s, i) => s.det[i],
    rotulo: `Frota de motos e mortes, índice ${mf.anos[0]} = 100` });

  grafIdade($("graf-idade"), p.faixas_idade, ["Motocicleta", "Pedestre", "Automóvel"].map(k => ({
    nome: NOME_MODO[k], cor: COR_MODO[k], valores: p.idade_modo[k] })));

  const at = p.atropeladores, n = st.estado.anos_taxa[1] - st.estado.ano_ini + 1;
  const dicaAt = x => `<div class="t">${esc(x.tipo)}</div>${linhaDica(COR_MODO["Pedestre"], fmt(x.mortes), "pedestres mortos", true)}` +
    (x.frota ? `<div class="l"><span class="s">${fmt(x.por_100mil, 1)} por ano para cada 100 mil veículos (frota média: ${fmtGrande(x.frota, "veículos")})</span></div>` : "");
  grafDoisPaineis($("graf-atropela"), [
    { titulo: "% dos pedestres mortos", cor: COR_MODO["Pedestre"], sufixo: "%",
      linhas: at.tipos.map(x => ({ nome: x.tipo, v: x.pct, dica: dicaAt(x) })), rotulo: "Porcentagem dos pedestres mortos por tipo de veículo" },
    { titulo: "Por 100 mil veículos da frota, por ano", cor: COR_MODO["Pedestre"], casas: 1,
      linhas: at.tipos.map(x => ({ nome: x.tipo, v: x.por_100mil, dica: dicaAt(x) })), rotulo: `Pedestres mortos por ano para cada 100 mil veículos, média de ${n} anos` },
  ]);

  const horas = Array.from({ length: 24 }, (_, h) => h);
  grafLinhas($("graf-letal"), horas, [
    { nome: "Rodovias", cor: COR.mortes, valores: p.letalidade_hora["Rodovias"] },
    { nome: "Vias urbanas", cor: COR.urbana, valores: p.letalidade_hora["Vias urbanas"] }],
    { rotuloX: (h, longo) => longo ? `${h}h–${h}h59` : h + "h", casas: 1, rotulo: "Letalidade por hora do dia" });

  const linhaVia = (cor, x, nome) => x ? linhaDica(cor, fmt(letal(x), 1), `${nome}: ${plural(x.m, "morte", "mortes")} em ${fmt(x.n)} sinistros`) : "";
  grafPares($("graf-tipo"), p.letalidade_tipo.itens.map(it => ({
    nome: it.tipo, valores: [letal(it.rodovia), letal(it.urbana)],
    dica: `<div class="t">${esc(it.tipo)}</div>${linhaVia(COR.mortes, it.rodovia, "rodovias")}${linhaVia(COR.urbana, it.urbana, "vias urbanas")}` })),
    SERIES_VIA, { casas: 1, rotulo: "Mortes por 100 sinistros com vítimas, por tipo de sinistro" });

  const lv = d.lv;
  grafLinhas($("graf-vel"), lv.classes, [
    { ...SERIES_VIA[0], valores: d.velR, k: "rodovia" }, { ...SERIES_VIA[1], valores: d.velU, k: "urbana" }],
    { casas: 1, rotuloX: (c, longo) => longo ? `Limite de ${c} km/h` : c,
      detalhe: (s, i) => `${plural(lv[s.k].m[i], "morte", "mortes")} em ${fmt(lv[s.k].n[i])} atropelamentos`,
      rotulo: "Mortes por 100 atropelamentos com vítimas, por limite de velocidade da via" });

  const sim = p.sim, prelim = a => sim.preliminar.includes(a);
  grafLinhas($("graf-sim"), sim.anos, [
    { nome: "Capital", cor: COR.mortes, valores: d.razCap, k: "capital" },
    { nome: "Demais municípios", cor: COR.urbana, valores: d.razDem, k: "demais" }],
    { ref: 100, rotuloX: (a, longo) => prelim(a) ? (longo ? `${a} (SIM preliminar)` : `${a}*`) : String(a),
      detalhe: (s, i) => `SIM: ${fmt(sim[s.k].sim[i])} · Infosiga: ${fmt(sim[s.k].infosiga[i])}`,
      rotulo: "Mortes no SIM para cada 100 no Infosiga, capital e demais municípios" });
}

// ------------------------------------------------------------------ estado: municípios

let mapaEstado, camadaEstado;
const camadaPorCod = {};

function iniciaEstado() {
  const e = st.estado;
  const d = new Date(e.atualizacao + "T12:00:00");
  document.querySelectorAll(".atualizacao").forEach(s => s.textContent = `${MESES[d.getMonth()]} de ${d.getFullYear()}`);
  document.querySelectorAll(".anos-taxa").forEach(s => s.textContent = `${e.anos_taxa[0]} a ${e.anos_taxa[1]}`);
  document.querySelectorAll(".ano-ini").forEach(s => s.textContent = e.ano_ini);
  const q = e.qualidade;
  const fora = q.sem_coordenada + q.fora_do_municipio + q.ponto_generico;
  $("nota-qualidade").textContent =
    `Não. ${fmt(100 * fora / q.total)}% dos sinistros com vítimas não têm local preciso: ${fmt(q.sem_coordenada)} sem coordenada, ` +
    `${fmt(q.fora_do_municipio)} com coordenada fora do município registrado e ${fmt(q.ponto_generico)} em pontos genéricos ` +
    `(a mesma coordenada para sinistros de muitas vias diferentes ou para números distantes da mesma via, ou endereços como "SP, Brasil").`;

  e.municipios.forEach(m => { st.porCod[m.cod] = m; });
  st.busca = e.municipios.map(m => ({ cod: m.cod, nome: m.nome, pop: m.pop || 0, chave: norm(m.nome) }));
  const tot = e.municipios.reduce((a, m) => ({ mortes: a.mortes + (m.mortes_ano || 0), sin: a.sin + (m.sinistros_ano || 0),
    pop: a.pop + (m.pop || 0), frota: a.frota + (m.frota || 0) }), { mortes: 0, sin: 0, pop: 0, frota: 0 });
  const pm = e.panorama.mortes_modo;
  const ia = e.panorama.anos_mortes.map((a, i) => [a, i]).filter(([a]) => a >= e.ano_ini).map(([, i]) => i);
  const soma = k => ia.reduce((a, i) => a + pm[k][i], 0);
  const totM = Object.keys(pm).reduce((a, k) => a + soma(k), 0);
  st.taxaEstado = { tx_mortes_hab: tot.mortes / tot.pop * 1e5, tx_sin_hab: tot.sin / tot.pop * 1e5,
    tx_mortes_veic: tot.mortes / tot.frota * 1e4, pct_mortes_moto: 100 * soma("Motocicleta") / totM };
  st.grandes = e.municipios.filter(m => m.pop > POP_GRANDE);
  iniciaPeriodo();
  $("cobertura-vmax").textContent = `${fmt(e.panorama.letalidade_velocidade.cobertura_todos)}%`;
  $("n-grandes").textContent = st.grandes.length;
}

function garanteMapaEstado() {
  if (mapaEstado) { mapaEstado.invalidateSize(); return; }
  mapaEstado = L.map("mapa-estado", { zoomSnap: 0.25, preferCanvas: true, scrollWheelZoom: false });
  camadaBase().addTo(mapaEstado);
  camadaEstado = L.geoJSON(st.estado.malha, {
    style: { weight: 0.5, color: "#ffffff", fillOpacity: 0.92 },
    onEachFeature: (f, layer) => {
      camadaPorCod[f.properties.cod] = layer;
      layer.on("click", () => { location.hash = f.properties.cod; });
      layer.on("mouseover", () => { layer.setStyle({ weight: 2, color: COR.tinta }); layer.bringToFront(); });
      layer.on("mouseout", () => layer.setStyle({ weight: 0.5, color: "#ffffff" }));
    },
  }).addTo(mapaEstado);
  mapaEstado.fitBounds(camadaEstado.getBounds(), { padding: [8, 8] });
  desenhaEstado();
}

function desenhaEstado() {
  const ind = st.indicador, cfg = INDICADORES[ind], suf = cfg.sufixo || "";
  const muns = st.estado.municipios;
  const valor = m => cfg.min && m.mortes < cfg.min ? null : m[ind];
  const q = quebras(muns.map(valor), 7);
  const cores = rampa(cfg.cores, q.length + 1);
  const cor = v => v == null ? COR.semDado : cores[classe(v, q)];
  camadaEstado.eachLayer(layer => {
    const m = st.porCod[layer.feature.properties.cod];
    const v = m && valor(m);
    layer.setStyle({ fillColor: cor(v) });
    layer.bindTooltip(`<b>${esc(m ? m.nome : "")}</b><br>${v == null ? "poucas mortes para calcular" : `<b>${fmt(v, cfg.casas)}${suf}</b> ${cfg.unidade}`}` +
      (m && m.pop ? `<br><span style="color:${COR.mudo}">${fmt(m.pop)} hab. · ${fmt(m.mortes_ano, 1)} mortes por ano</span>` : ""), { sticky: true });
  });
  const leg = $("legenda-estado");
  leg.innerHTML = "";
  leg.appendChild(legendaEscala(cores, q, cfg.casas, suf));
  if (cfg.min) leg.appendChild(el("span", { className: "item-leg" }, `<i class="sem-dado"></i>menos de ${cfg.min} mortes desde ${st.estado.ano_ini}`));
  $("titulo-indicador").textContent = cfg.titulo;
  $("nota-indicador").textContent = ind === "pct_mortes_moto" ? `% das mortes desde ${st.estado.ano_ini} que foram de motociclistas` :
    `média anual de ${st.estado.anos_taxa[0]} a ${st.estado.anos_taxa[1]}`;
  $("ref-estado").innerHTML = `<b>${fmt(st.taxaEstado[ind], cfg.casas)}${suf}</b><span>média do estado</span>`;

  const ol = $("ranking-estado");
  ol.innerHTML = "";
  const lista = st.grandes.filter(m => valor(m) != null).sort((a, b) => valor(b) - valor(a)).slice(0, 40);
  const max = lista.length ? valor(lista[0]) : 1;
  lista.forEach((m, i) => {
    const v = valor(m);
    const li = el("li", { tabIndex: 0 }, `<span class="pos">${i + 1}</span><span>${esc(m.nome)}</span><span class="val">${fmt(v, cfg.casas)}${suf}</span>` +
      `<span class="barra"><i style="width:${100 * v / max}%;background:${cfg.cores[4]}"></i></span>`);
    const abre = () => { location.hash = m.cod; };
    li.addEventListener("click", abre);
    li.addEventListener("keydown", ev => { if (ev.key === "Enter") abre(); });
    const layer = camadaPorCod[m.cod];
    li.addEventListener("mouseenter", () => { if (layer) { layer.setStyle({ weight: 2.5, color: COR.tinta }); layer.bringToFront(); } });
    li.addEventListener("mouseleave", () => { if (layer) layer.setStyle({ weight: 0.5, color: "#ffffff" }); });
    ol.appendChild(li);
  });
}

// ------------------------------------------------------------------ estado: locais mais perigosos

function tabelaLocais() {
  const p = st.estado.panorama;
  const pontos = st.locaisTipo === "pontos", porMortes = st.locaisOrdem === "mortes";
  const lista = pontos ? (porMortes ? p.pontos_letais : p.pontos) : (porMortes ? p.trechos_letais : p.trechos);
  $("nota-locais").textContent = pontos ?
    `Locais com cerca de 100 m de diâmetro nas vias urbanas, de ${st.estado.ano_ini} até hoje. O registro de sinistros não fatais varia entre municípios, o que pesa na lista por número de sinistros. Clique num local para vê-lo no mapa do município.` :
    `Sinistros com vítimas por rodovia e km, de ${st.estado.ano_ini} até hoje; a imagem mostra um raio de 500 m em torno do km. Clique num trecho para vê-lo no mapa do município.`;
  const chave = porMortes ? "mortes" : "n", cor = porMortes ? COR.mortes : COR.sin;
  const max = Math.max(1, ...lista.map(x => x[chave]));
  const t = $("tabela-locais");
  t.innerHTML = `<thead><tr><th class="pos">#</th><th class="foto"><span class="so-leitor">Imagem de satélite</span></th><th>${pontos ? "Local" : "Trecho"}</th>` +
    `<th class="num">${porMortes ? "Mortes" : 'Sinistros<span class="so-largo"> com vítimas</span>'}</th><th class="num col-sec">${porMortes ? "Sinistros" : "Mortes"}</th>` +
    `<th class="num col-opc">Feridos graves</th><th class="num col-opc">Com moto</th></tr></thead>`;
  const tb = el("tbody");
  lista.slice(0, st.nLocais).forEach((x, i) => {
    const tr = el("tr", { tabIndex: 0 }, `<td class="pos">${i + 1}</td><td class="foto">${miniatura(pontos ? "ponto" : "trecho", x, 80, 56)}</td>` +
      `<td class="local"><b>${esc(x.nome)}</b>${x.aproximado ? '<span class="selo">local aproximado</span>' : ""}<span class="mun">${esc(x.municipio)}</span></td>` +
      `<td class="num principal"><span class="celula-barra"><span class="barra"><i style="width:${100 * x[chave] / max}%;background:${cor}"></i></span><b>${fmt(x[chave])}</b></span></td>` +
      `<td class="num col-sec">${fmt(porMortes ? x.n : x.mortes)}</td><td class="num col-opc">${fmt(x.graves)}</td><td class="num col-opc">${fmt(x.pct_moto)}%</td>`);
    const abre = () => abreLocal(x.cod, { tipo: pontos ? "ponto" : "trecho", lat: x.lat, lon: x.lon });
    tr.addEventListener("click", abre);
    tr.addEventListener("keydown", ev => { if (ev.key === "Enter") abre(); });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const total = Math.min(50, lista.length), botao = $("mais-locais");
  botao.hidden = st.nLocais >= total;
  botao.textContent = `Mostrar mais ${Math.min(15, total - st.nLocais)}`;
}

function abreLocal(cod, foco) {
  st.focoPendente = foco;
  if (location.hash === "#" + cod) rota();
  else location.hash = cod;
}

function aplicaFoco() {
  const f = st.focoPendente;
  st.focoPendente = null;
  if (!f || !st.mun) return;
  $("onde").scrollIntoView({ block: "start" });
  if (st.area) limpaArea();
  trocaAba(f.tipo === "ponto" ? "pontos" : "trechos");
  const mesmo = x => x.lat != null && Math.abs(x.lat - f.lat) < 1e-4 && Math.abs(x.lon - f.lon) < 1e-4;
  const lista = st.listas[f.tipo === "ponto" ? "pontos" : "trechos"], i = lista.findIndex(mesmo);
  const div = document.querySelectorAll("#lista-aba .item")[i];
  if (i >= 0 && div) { focaItem(f.tipo, lista[i], div); div.scrollIntoView({ block: "nearest" }); return; }
  // fora da lista do período escolhido: mostra o local mesmo assim
  const x = (f.tipo === "ponto" ? st.mun.pontos : st.mun.trechos).find(mesmo);
  if (x) focaItem(f.tipo, x, null);
  else if (f.lat != null) { moveProg(); mapaMun.setView([f.lat, f.lon], f.tipo === "ponto" ? 17 : 14); }
}

// ------------------------------------------------------------------ município

let mapaMun, contornoMun;
const resolucao = z => z >= 14 ? 9 : z >= 12 ? 8 : 7;
const opacidade = z => z >= 16 ? 0.45 : 0.8;  // de perto, as ruas precisam aparecer
const AREA = { 9: "0,1", 8: "0,7", 7: "5" };

function cabecalhoMunicipio(cod) {
  const r = st.porCod[cod];
  if (!r) return;
  $("nome-municipio").textContent = r.nome;
  document.title = `${r.nome}: sinistros de trânsito`;
  const meta = [regiao(r.regiao), r.pop ? fmtGrande(r.pop, "habitantes") : "", r.frota ? fmtGrande(r.frota, "veículos") : ""].filter(Boolean);
  $("mun-meta").innerHTML = meta.map(t => `<span>${esc(t)}</span>`).join("");
}

async function abreMunicipio(cod) {
  st.carregando = cod;
  cabecalhoMunicipio(cod);
  const vista = $("vista-municipio");
  vista.style.opacity = st.mun ? 0.45 : 1;  // mantém a vista anterior, esmaecida, enquanto carrega
  const resp = await fetch(`data/mun/${cod}.json`, { cache: "no-cache" });  // revalida: os dados mudam a cada atualização
  if (!resp.ok || st.carregando !== cod) { vista.style.opacity = 1; return; }
  const m = await resp.json();
  if (st.carregando !== cod) return;
  vista.style.opacity = 1;
  st.mun = m; st.ativo = null;
  totaisPeriodo(m);  // antes de mover o mapa: o zoom redesenha os hexágonos

  if (!mapaMun) {
    mapaMun = L.map("mapa-municipio", { preferCanvas: true, maxZoom: 18 });
    // vias e rótulos ficam acima dos hexágonos (overlayPane, z 400), sem capturar o mouse
    [["vias", 420], ["rotulos", 450]].forEach(([nome, z]) => {
      const p = mapaMun.createPane(nome);
      p.style.zIndex = z;
      p.style.pointerEvents = "none";
    });
    mapaMun.getPane("vias").style.filter = "grayscale(1)";  // ruas em cinza, para não competir com a escala de cores
    camadaBase().addTo(mapaMun);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      { maxNativeZoom: 16, maxZoom: 18, pane: "vias", opacity: 0.75 }).addTo(mapaMun);
    L.tileLayer(BASE + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, pane: "rotulos" }).addTo(mapaMun);
    mapaMun.on("zoomend", () => {
      if (!st.mun) return;
      const z = mapaMun.getZoom();
      if (resolucao(z) !== st.resAtual) { desenhaHex(); redesenhaDestaque(false); }
      else if (opacidade(z) !== st.opac) { st.opac = opacidade(z); st.camadaHex.setStyle({ fillOpacity: st.opac }); }
    });
    // depois que a pessoa move o mapa, oferece listar só os locais da área visível
    mapaMun.on("moveend", () => {
      if (performance.now() < st.movProg) { st.movProg = 0; return; }
      atualizaBotaoArea();
    });
  }
  if (contornoMun) contornoMun.remove();
  contornoMun = L.geoJSON(m.contorno, { style: { color: COR.tinta2, weight: 1.5, fill: false, dashArray: "5 4" }, interactive: false }).addTo(mapaMun);
  moveProg();
  mapaMun.invalidateSize();
  st.enquadramento = enquadramento(m);
  st.resAtual = null;
  moveProg();
  mapaMun.fitBounds(st.enquadramento, { animate: false });
  limpaDestaque();
  limpaArea(false);
  $("filtra-area").hidden = true;

  calculaListas();
  textosPeriodo(m);
  desenhaHex();
  desenhaMarcadores();
  trocaAba(st.listas.pontos.length ? "pontos" : st.listas.vias.length ? "vias" : "trechos");
  desenhaGraficosMun(m);
  if (st.focoPendente) aplicaFoco();
  else scrollTo(0, 0);
}

// tudo o que depende do período escolhido
function aplicaPeriodo() {
  const m = st.mun;
  limpaDestaque();
  totaisPeriodo(m);
  calculaListas();
  textosPeriodo(m);
  desenhaHex();
  desenhaMarcadores();
  trocaAba(st.aba);
  desenhaGraficosMun(m);
}

function desenhaGraficosMun(m) {
  const P = periodo(), destaque = P.todo ? null : [P.a, P.b];
  quemMorre(m);
  horaDia(m);
  serie($("serie-sinistros"), "Sinistros com vítimas", m.serie.anos, m.serie.sinistros, COR.sin, destaque);
  serie($("serie-mortes"), "Mortes", m.serie.anos_mortes, m.serie.mortes, COR.mortes, destaque);
  frotaMun(m);
}

// ------------------------------------------------------------------ município: período e área do mapa

// soma de um vetor por ano nos índices [i0, i1]; 0 no lugar do vetor quer dizer só zeros
const somaP = (v, [i0, i1]) => { let s = 0; if (v) for (let i = i0; i <= i1; i++) s += v[i]; return s; };

// anos com dados; o último pode estar incompleto
function anosDados() {
  const e = st.estado, fim = new Date(e.atualizacao + "T12:00:00");
  const ultimo = fim.getFullYear(), mesFim = fim.getMonth() + 1;
  return { anos: Array.from({ length: ultimo - e.ano_ini + 1 }, (_, i) => e.ano_ini + i), mesFim, parcial: mesFim < 12 };
}

// período escolhido: anos [a, b], índices dos vetores por ano, duração em anos e texto ("desde 2019", "de 2021 a 2023")
function periodo() {
  const { anos, mesFim, parcial } = anosDados();
  const [a, b] = st.periodo || [anos[0], anos.at(-1)];
  const ateHoje = b === anos.at(-1), incompleto = ateHoje && parcial;
  const texto = a === b ? (incompleto ? `em ${a}, até ${MESES[mesFim - 1]}` : `em ${a}`) : ateHoje ? `desde ${a}` : `de ${a} a ${b}`;
  return { a, b, idx: [a - anos[0], b - anos[0]], todo: !st.periodo, texto, incompleto, mesFim,
    nAnos: b - a + (incompleto ? mesFim / 12 : 1) };
}

function iniciaPeriodo() {
  const { anos, mesFim, parcial } = anosDados();
  const de = $("ano-de"), ate = $("ano-ate"), todo = $("periodo-todo");
  de.innerHTML = ate.innerHTML = anos.map(a =>
    `<option value="${a}">${a}${a === anos.at(-1) && parcial ? ` (até ${MESES[mesFim - 1].slice(0, 3)}.)` : ""}</option>`).join("");
  de.value = anos[0]; ate.value = anos.at(-1);
  const muda = origem => {
    let a = +de.value, b = +ate.value;
    if (a > b) { if (origem === de) b = a; else a = b; de.value = a; ate.value = b; }
    st.periodo = a === anos[0] && b === anos.at(-1) ? null : [a, b];
    todo.hidden = !st.periodo;
    if (st.mun) aplicaPeriodo();
  };
  de.addEventListener("change", () => muda(de));
  ate.addEventListener("change", () => muda(ate));
  todo.addEventListener("click", () => { de.value = anos[0]; ate.value = anos.at(-1); muda(de); });
}

// totais do período em cada local e hexágono (os locais guardam as contagens por ano em x.a)
function totaisPeriodo(m) {
  const p = periodo().idx, tudo = [0, m.anos.length - 1];
  const calc = x => {
    const a = x.a;
    x.n = somaP(a.n, p); x.fatais = somaP(a.f, p); x.mortes = somaP(a.m, p); x.graves = somaP(a.g, p);
    x.pct_moto = x.n ? Math.round(100 * somaP(a.mo, p) / x.n) : null;
    x.pct_ped = x.n ? Math.round(100 * somaP(a.pe, p) / x.n) : null;
  };
  m.pontos.forEach(calc);
  m.trechos.forEach(calc);
  m.vias.forEach(v => { calc(v); v.por_km = v.km ? v.n / v.km : null; });
  // [id, sinistros, fatais, mortes, feridos graves, maior pilha, vias, sinistros em todos os anos]
  st.hexPeriodo = m.hex.map(([id, n, f, mo, g, pilha, vias]) =>
    [id, somaP(n, p), somaP(f, p), somaP(mo, p), somaP(g, p), pilha, vias, somaP(n, tudo)]).filter(h => h[1] > 0);
}

const ordemLocais = (a, b) => b.n - a.n || b.mortes - a.mortes;
const naArea = x => !st.area || (x.lat != null && st.area.contains([x.lat, x.lon]));

// listas do período; os pontos críticos e as rodovias também respeitam a área escolhida no mapa
function calculaListas() {
  const m = st.mun;
  st.listas = {
    pontos: m.pontos.filter(x => x.n >= MIN_PONTO && naArea(x)).sort(ordemLocais).slice(0, TOP.pontos),
    vias: m.vias.filter(x => x.n > 0).sort(ordemLocais).slice(0, TOP.vias),
    trechos: m.trechos.filter(x => x.n > 0 && naArea(x)).sort(ordemLocais).slice(0, TOP.trechos),
  };
  document.querySelectorAll(".abas button").forEach(b => { b.querySelector(".contagem").textContent = st.listas[b.dataset.aba].length || ""; });
}

function textosPeriodo(m) {
  const P = periodo();
  document.querySelectorAll(".periodo-mun").forEach(s => { s.textContent = P.texto; });
  $("sub-ano").textContent = "sinistros com vítimas e mortes" + (P.todo ? "" : "; em destaque, o período escolhido");
  kpis(m);
  destaques(m);
}

// movimentos do mapa feitos pelo site (e não pela pessoa) não oferecem o filtro por área
const moveProg = () => { st.movProg = performance.now() + 1000; };

function atualizaBotaoArea() {
  if (!st.mun || !contornoMun) return;
  const b = mapaMun.getBounds();
  const tudo = b.contains(contornoMun.getBounds());
  $("filtra-area").hidden = tudo && !st.area;
}

function defineArea(b) {
  st.area = b;
  if (st.retArea) st.retArea.remove();
  st.retArea = L.rectangle(b, { color: COR.tinta2, weight: 1.5, dashArray: "6 5", fill: false, interactive: false }).addTo(mapaMun);
  $("filtra-area").hidden = true;
  $("filtro-area").hidden = false;
  limpaDestaque();
  calculaListas();
  desenhaMarcadores();
  trocaAba(st.aba === "vias" ? "pontos" : st.aba);
}

function limpaArea(redesenha = true) {
  st.area = null;
  if (st.retArea) { st.retArea.remove(); st.retArea = null; }
  $("filtro-area").hidden = true;
  if (!redesenha || !st.mun) return;
  limpaDestaque();
  calculaListas();
  desenhaMarcadores();
  trocaAba(st.aba);
  atualizaBotaoArea();
}

// frota do município (Senatran, dezembro de cada ano) comparada com a do estado
function frotaMun(m) {
  const f = m.frota, box = $("historia-frota");
  $("frota").hidden = !f;
  if (!f) return;
  const e = st.estado, mf = e.panorama.motos_frota, [t0, t1] = e.anos_taxa;
  const pop = e.municipios.reduce((a, x) => a + (x.pop || 0), 0);
  const noPeriodo = (v, anos) => v.reduce((a, x, i) => a + (anos[i] >= t0 && anos[i] <= t1 ? x : 0), 0);
  // motociclistas mortos por ano para cada 10 mil motos: mortes e frotas somadas nos anos das taxas
  const taxa = (mortes, motos, anos) => 1e4 * noPeriodo(mortes, anos) / noPeriodo(motos, anos);
  const est = {
    pctMotos: 100 * mf.frota_motos.at(-1) / mf.frota_total.at(-1), por100: 100 * mf.frota_total.at(-1) / pop,
    cMotos: varPct(mf.frota_motos[0], mf.frota_motos.at(-1)), cAutos: varPct(mf.frota_autos[0], mf.frota_autos.at(-1)),
    taxa: taxa(mf.mortes_moto, mf.frota_motos, mf.anos),
  };
  const r = m.resumo, a0 = f.anos[0], aU = f.anos.at(-1), nMortes = noPeriodo(f.mortes_moto, f.anos);
  const pctMotos = 100 * f.motos.at(-1) / f.total.at(-1);
  const cMotos = varPct(f.motos[0], f.motos.at(-1)), cAutos = varPct(f.autos[0], f.autos.at(-1));
  const variacao = c => Math.abs(c) < 1 ? "ficou estável" : c > 0 ? `cresceu ${fmt(c)}%` : `encolheu ${fmt(-c)}%`;
  const texto = `<b>da frota de ${esc(m.nome)} são motos</b> (estado: ${fmt(est.pctMotos)}%). ` +
    `Em dezembro de ${aU} eram ${fmtGrande(f.total.at(-1), "veículos")}` +
    (r.pop ? `, ${fmt(100 * f.total.at(-1) / r.pop)} para cada 100 habitantes (estado: ${fmt(est.por100)})` : "") + ". " +
    `Desde ${a0}, a frota de motos ${variacao(cMotos)} e a de automóveis ${variacao(cAutos)} ` +
    `(no estado, ${comSinal(est.cMotos)}% e ${comSinal(est.cAutos)}%). ` +
    (f.motos.at(-1) ? `De ${t0} a ${t1}, ${nMortes === 0 ? "nenhum motociclista morreu no trânsito do município" :
      `morreram por ano ${fmt(taxa(f.mortes_moto, f.motos, f.anos), 1)} motociclistas para cada 10 mil motos registradas ` +
      `(estado: ${fmt(est.taxa, 1)})`}.` : "") +
    (nMortes > 0 && nMortes < 10 ? " Com tão poucas mortes, essa taxa varia muito." : "");
  box.innerHTML = `<div class="historia-texto"><div class="grande">${fmt(pctMotos)}%</div><p>${texto}</p></div>
    <figure><figcaption><h3>Frota de motos e de automóveis</h3><p>índice, ${a0} = 100; frota registrada em dezembro de cada ano (Senatran)</p></figcaption>
    <div class="grafico" id="graf-frota-mun"></div><div class="grafico" id="serie-mortes-moto"></div>
    <p class="nota nota-graf">As mortes contam o local do sinistro; a frota, o município onde o veículo está registrado.</p></figure>`;
  const indice = v => v.map(x => v[0] ? 100 * x / v[0] : null);
  grafLinhas($("graf-frota-mun"), f.anos, [
    { nome: "Motos", cor: COR_MODO["Motocicleta"], valores: indice(f.motos), det: f.motos.map(n => fmtGrande(n, "motos")) },
    { nome: "Automóveis", cor: COR_FROTA, valores: indice(f.autos), det: f.autos.map(n => fmtGrande(n, "automóveis")) },
  ], { ref: 100, detalhe: (s, i) => s.det[i], rotulo: `Frota de motos e de automóveis, índice ${a0} = 100` });
  serie($("serie-mortes-moto"), "Motociclistas mortos", f.anos, f.mortes_moto, COR_MODO["Motocicleta"]);
}

// área com 70% dos sinistros de todos os anos (os hexágonos vêm do que tem mais sinistros para o que tem menos)
function enquadramento(m) {
  const tudo = [0, m.anos.length - 1], n = h => somaP(h[1], tudo);
  const total = m.hex.reduce((a, h) => a + n(h), 0);
  if (!total) return contornoMun.getBounds();
  const b = L.latLngBounds([]);
  let acum = 0;
  for (const h of m.hex) {
    h3.cellToBoundary(h[0]).forEach(p => b.extend(p));
    acum += n(h);
    if (acum >= 0.7 * total) break;
  }
  return b;
}

function delta(v, ref) {
  if (v == null || !ref) return "";
  const d = 100 * (v / ref - 1);
  if (Math.abs(d) < 5) return `<span class="delta igual">≈ média do estado</span>`;
  return `<span class="delta ${d > 0 ? "acima" : "abaixo"}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}% ${d > 0 ? "acima" : "abaixo"} do estado</span>`;
}

function kpis(m) {
  const r = m.resumo, est = st.taxaEstado, a = st.estado.anos_taxa, P = periodo(), pa = m.por_ano;
  const mortes = somaP(pa.mortes, P.idx), sin = somaP(pa.sinistros, P.idx), rod = somaP(pa.mortes_rodovia, P.idx);
  const poucas = r.mortes_ano * (a[1] - a[0] + 1) < 10;
  let pos = "";
  if (r.pop > POP_GRANDE && r.tx_mortes_hab != null) {
    const k = st.grandes.filter(x => x.tx_mortes_hab > r.tx_mortes_hab).length + 1;
    pos = `${k}ª maior taxa entre ${st.grandes.length} municípios com +50 mil hab.`;
  }
  // média anual no período (o último ano conta só os meses com dados)
  const porAno = v => P.nAnos > 1 ? `${fmt(v / P.nAnos, v / P.nAnos < 10 ? 1 : 0)} por ano` : "";
  // as taxas são sempre as dos anos usados no mapa do estado, para comparar com ele
  const taxas = `em ${a[0]}–${a[1]}`;
  const itens = [
    { rot: `Mortes ${P.texto}`, val: fmt(mortes), comp: porAno(mortes) },
    { rot: `Sinistros com vítimas ${P.texto}`, val: fmt(sin), comp: porAno(sin) },
    { rot: "Mortes por 100 mil habitantes, por ano", val: fmt(r.tx_mortes_hab, 1), delta: delta(r.tx_mortes_hab, est.tx_mortes_hab),
      comp: `${taxas} · estado: ${fmt(est.tx_mortes_hab, 1)}` + (poucas ? "<br>poucas mortes: a taxa varia muito" : pos ? `<br>${pos}` : "") },
    { rot: "Mortes por 10 mil veículos, por ano", val: fmt(r.tx_mortes_veic, 2), delta: delta(r.tx_mortes_veic, est.tx_mortes_veic),
      comp: `${taxas} · estado: ${fmt(est.tx_mortes_veic, 2)}` },
    { rot: "Das mortes ocorreram em rodovias", val: mortes ? fmt(100 * rod / mortes) + "%" : "—", comp: P.texto },
  ];
  const box = $("kpis");
  box.innerHTML = "";
  itens.forEach(it => box.appendChild(el("div", { className: "kpi" },
    `<div class="rotulo">${it.rot}</div><div class="valor">${it.val}</div>${it.delta || ""}<div class="comp">${it.comp}</div>`)));
}

// mortes por modo de deslocamento no estado, em % das mortes do período
function pctModoEstado(P) {
  const p = st.estado.panorama, pm = p.mortes_modo;
  const soma = k => p.anos_mortes.reduce((s, a, i) => s + (a >= P.a && a <= P.b ? pm[k][i] : 0), 0);
  const tot = Object.keys(pm).reduce((s, k) => s + soma(k), 0);
  return Object.fromEntries(Object.keys(pm).map(k => [k, tot ? 100 * soma(k) / tot : null]));
}

// "Em resumo": frases sobre o período escolhido, comparando o município com o estado
function destaques(m) {
  const P = periodo(), pa = m.por_ano, s = k => somaP(pa[k], P.idx), t = [];
  const modo = Object.fromEntries(Object.keys(pa.modo).map(k => [k, somaP(pa.modo[k], P.idx)]));
  const totM = Object.values(modo).reduce((a, b) => a + b, 0), est = pctModoEstado(P);
  if (totM >= 10) {
    t.push(`Motociclistas são ${fmt(100 * modo["Motocicleta"] / totM)}% das mortes ${P.texto} (estado: ${fmt(est["Motocicleta"])}%).`);
    const ped = modo["Pedestre"];
    if (ped >= 5) t.push(`Pedestres são ${fmt(100 * ped / totM)}% das mortes (estado: ${fmt(est["Pedestre"])}%); ` +
      `${fmt(100 * s("ped_idosos") / ped)}% dos pedestres mortos tinham 60 anos ou mais.`);
  }
  const nUrb = s("urbanos"), pts = m.pontos.filter(x => x.n >= MIN_PONTO).sort(ordemLocais);
  if (pts.length && nUrb >= 100) {
    const k = Math.min(10, pts.length), soma = pts.slice(0, k).reduce((a, x) => a + x.n, 0), p0 = pts[0];
    t.push((k > 1 ? `Os ${k} pontos com mais sinistros nas vias urbanas, cada um com cerca de 100 m de diâmetro, reúnem` :
      "O ponto com mais sinistros nas vias urbanas, com cerca de 100 m de diâmetro, reúne") +
      ` ${fmt(100 * soma / nUrb)}% dos sinistros com vítimas dessas vias.`);
    t.push(`O ponto com mais sinistros é ${p0.nome}: ${fmt(p0.n)} sinistros com vítimas e ${plural(p0.mortes, "morte", "mortes")} ${P.texto}.`);
  }
  const mortes = s("mortes");
  if (mortes >= 10) {
    let frase = `${fmt(100 * s("mortes_rodovia") / mortes)}% das mortes ocorreram em rodovias`;
    const letal = m.trechos.filter(x => x.mortes > 0).sort((a, b) => b.mortes - a.mortes || b.n - a.n)[0];
    if (letal && letal.mortes >= 3) frase += `; o km com mais mortes é ${letal.nome} (${letal.mortes})`;
    t.push(frase + ".");
  }
  // tendência: sempre o último ano completo contra a média dos anos-base, qualquer que seja o período
  const sr = m.serie, [b0, b1] = st.estado.anos_base, ult = st.estado.anos_taxa[1];
  const base = sr.anos_mortes.map((a, i) => [a, sr.mortes[i]]).filter(([a]) => a >= b0 && a <= b1).map(x => x[1]);
  const mb = base.reduce((a, b) => a + b, 0) / base.length, iu = sr.anos_mortes.indexOf(ult);
  if (iu >= 0 && mb >= 10) {
    const u = sr.mortes[iu], v = 100 * (u / mb - 1);
    t.push(`Em ${ult} foram ${fmt(u)} mortes, ${fmt(Math.abs(v))}% ${v > 0 ? "a mais" : "a menos"} que a média de ` +
      `${b0} a ${b1} (${fmt(mb, 1)} por ano).`);
  }
  if (mortes >= 20)
    t.push(`Entre 0h e 6h acontecem ${fmt(100 * s("madrugada") / s("sinistros"))}% dos sinistros com vítimas ` +
      `e ${fmt(100 * s("madrugada_mortes") / mortes)}% das mortes.`);
  const ul = $("destaques");
  ul.innerHTML = "";
  t.forEach(x => ul.appendChild(el("li", { textContent: x })));
  $("resumo").hidden = !t.length;
}

function agregaHex(hexes, res) {
  if (res === 9) return hexes;
  const acc = new Map();
  for (const [id, n, f, m, g, pilha, vias, nTodos] of hexes) {
    const pai = h3.cellToParent(id, res);
    let a = acc.get(pai);
    if (!a) { a = [pai, 0, 0, 0, 0, 0, new Map(), 0]; acc.set(pai, a); }
    a[1] += n; a[2] += f; a[3] += m; a[4] += g; a[5] = Math.max(a[5], pilha); a[7] += nTodos;
    for (const [nome, k] of vias) a[6].set(nome, (a[6].get(nome) || 0) + k);
  }
  return [...acc.values()].map(a => { a[6] = [...a[6].entries()].sort((x, y) => y[1] - x[1]).slice(0, 3); return a; });
}

function desenhaHex() {
  const m = st.mun;
  if (st.camadaHex) st.camadaHex.remove();
  const fatal = st.modoMapa === "f";
  const idx = fatal ? 2 : 1;
  const res = resolucao(mapaMun.getZoom());
  st.resAtual = res;
  st.opac = opacidade(mapaMun.getZoom());
  const hexes = agregaHex(st.hexPeriodo, res).filter(h => h[idx] > 0);
  const P = periodo();
  const q = quebras(hexes.map(h => h[idx]), fatal ? 4 : 7);
  const cores = rampa(fatal ? AMEIXA : CALOR, q.length + 1);
  const grupo = L.featureGroup();
  hexes.forEach(h => {
    const [id, n, f, mortes, graves, pilha, vias, nTodos] = h;
    const poly = L.polygon(h3.cellToBoundary(id), { weight: 0.6, color: "#ffffff", fillColor: cores[classe(h[idx], q)], fillOpacity: st.opac });
    // as vias e a pilha na mesma coordenada são contadas em todos os anos
    const viasHtml = vias.map(([nome, k]) => esc(nome) + (P.todo ? ` (${fmt(k)})` : "")).join("<br>");
    const aviso = res === 9 && pilha >= 20 && pilha / nTodos > 0.5 ?
      `<div class="aviso">${P.todo ? fmt(pilha) : `Desde ${st.estado.ano_ini}, ${fmt(pilha)} dos ${fmt(nTodos)}`} destes sinistros estão na mesma coordenada; a localização pode ser aproximada.</div>` : "";
    poly.bindTooltip(`<b>${fmt(n)}</b> sinistros com vítimas · <b>${fmt(mortes)}</b> ${mortes === 1 ? "morte" : "mortes"}`, { sticky: true });
    poly.bindPopup(`<div class="popup"><h4>Nesta área, ${P.texto}</h4>` +
      `<div class="numeros"><div><b>${fmt(n)}</b><span>sinistros com vítimas</span></div><div><b>${fmt(mortes)}</b><span>${mortes === 1 ? "morte" : "mortes"}</span></div>` +
      `<div><b>${fmt(graves)}</b><span>feridos graves</span></div></div>` +
      `<div class="linha-det">${plural(f, "sinistro fatal", "sinistros fatais")}</div>` +
      (viasHtml ? `<div class="vias-reg"><b>Vias com mais sinistros</b>${viasHtml}</div>` : "") + aviso +
      (res < 9 ? `<div class="dica-zoom">Aproxime o mapa para ver hexágonos menores.</div>` : "") + "</div>");
    grupo.addLayer(poly);
  });
  grupo.addTo(mapaMun);
  st.camadaHex = grupo;
  const leg = $("legenda-municipio");
  leg.innerHTML = "";
  leg.appendChild(legendaEscala(cores, q));
  leg.appendChild(el("span", { className: "item-leg", textContent: `${fatal ? "sinistros fatais" : "sinistros"} por hexágono de ≈${AREA[res]} km²` }));
  const semLocal = somaP(m.por_ano.sem_local, P.idx), total = somaP(m.por_ano.sinistros, P.idx);
  $("nota-mapa").textContent = (semLocal ?
    `${fmt(semLocal)} sinistros (${fmt(100 * semLocal / Math.max(1, total))}%) sem local preciso ficam fora do mapa. ` : "") +
    "Os hexágonos ficam menores quando você aproxima o mapa; os números marcam os 10 pontos críticos da lista.";
}

function desenhaMarcadores() {
  if (st.marcadores) st.marcadores.remove();
  const g = L.layerGroup();
  st.listaMarcadores = [];
  st.listas.pontos.slice(0, N_MARCADOS).forEach((p, i) => {
    const mk = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "marcador", html: String(i + 1), iconSize: [24, 24] }), zIndexOffset: 1000, title: p.nome });
    mk.on("click", () => {
      trocaAba("pontos");
      const div = document.querySelectorAll("#lista-aba .item")[i];
      focaItem("ponto", p, div);
      div.scrollIntoView({ block: "nearest" });
    });
    g.addLayer(mk);
    st.listaMarcadores.push(mk);
  });
  g.addTo(mapaMun);
  st.marcadores = g;
}

function trocaAba(aba) {
  st.aba = aba;
  document.querySelectorAll(".abas button").forEach(b => { b.classList.toggle("ativo", b.dataset.aba === aba); b.setAttribute("aria-selected", b.dataset.aba === aba); });
  const m = st.mun, box = $("lista-aba"), nota = $("nota-aba");
  box.innerHTML = "";
  box.scrollTop = 0;
  limpaDestaque();
  const det = x => {
    const d = [`<b>${plural(x.mortes, "morte", "mortes")}</b>`, plural(x.graves, "ferido grave", "feridos graves"), `${fmt(x.pct_moto)}% com moto`];
    if (x.pct_ped >= 10) d.push(`${fmt(x.pct_ped)}% com pedestre`);
    return d;
  };
  const P = periodo(), L_ = st.listas, naAreaTxt = st.area ? " na área marcada no mapa" : "";
  let itens = [];
  if (aba === "pontos") {
    nota.textContent = !m.pontos.length ? "Poucos sinistros localizados nas vias urbanas para identificar pontos críticos." :
      !L_.pontos.length ? `Nenhum local com ${MIN_PONTO} ou mais sinistros com vítimas nas vias urbanas${naAreaTxt} ${P.texto}.` :
      `Locais de cerca de 100 m de diâmetro com mais sinistros com vítimas nas vias urbanas${naAreaTxt}. Rodovias na aba ao lado.` +
      (st.area && m.pontos_min ? ` Entram só os ${fmt(m.pontos.length)} locais com mais sinistros desde ${st.estado.ano_ini} (${m.pontos_min} ou mais).` : "");
    itens = L_.pontos.map((p, i) => ({ x: p, tipo: "ponto", marcado: i < N_MARCADOS,
      det: det(p).concat(p.aproximado ? ['<span class="selo">local aproximado</span>'] : []) }));
  } else if (aba === "vias") {
    nota.textContent = "Vias com mais sinistros com vítimas. Por km: sinistros divididos pelo comprimento da via no município (OpenStreetMap)." +
      (st.area ? " As vias somam o município todo, não só a área marcada." : "");
    itens = L_.vias.map(v => ({ x: v, tipo: "via", det: det(v).concat(v.por_km ? [`<b>${fmt(v.por_km)} por km</b> (${fmt(v.km, 1)} km)`] : []) }));
  } else {
    nota.textContent = !m.trechos.length ? "Sem sinistros em rodovias com km registrado." :
      !L_.trechos.length ? `Nenhum sinistro em rodovias${naAreaTxt} ${P.texto}.` : `Sinistros com vítimas por rodovia e km${naAreaTxt}.`;
    itens = L_.trechos.map(t => ({ x: t, tipo: "trecho", det: det(t) }));
  }
  if (!itens.length) return;
  const max = Math.max(1, ...itens.map(i => i.x.n));
  const comFoto = aba !== "vias";  // uma via inteira não cabe numa imagem
  itens.forEach((it, i) => {
    const x = it.x;
    const div = el("div", { className: "item" + (comFoto ? " com-foto" : ""), tabIndex: 0 },
      `<span class="pos${it.marcado ? " marcado" : ""}">${i + 1}</span>` + (comFoto ? miniatura(it.tipo, x, 72, 54) : "") +
      `<span class="nome">${esc(x.nome)}</span>` +
      `<span class="num">${fmt(x.n)}<small>${x.n === 1 ? "sinistro" : "sinistros"}</small></span>` +
      `<div class="barra"><i style="width:${100 * x.n / max}%"></i></div><span class="det">${it.det.join(" · ")}</span>`);
    div.setAttribute("role", "button");
    const ativa = () => focaItem(it.tipo, x, div);
    div.addEventListener("click", ativa);
    div.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ativa(); } });
    box.appendChild(div);
  });
}

function limpaDestaque() {
  document.querySelectorAll(".item.ativa").forEach(x => x.classList.remove("ativa"));
  (st.listaMarcadores || []).forEach(mk => { const e = mk.getElement(); if (e) e.classList.remove("ativo"); });
  if (st.camadaDestaque) { st.camadaDestaque.remove(); st.camadaDestaque = null; }
  if (mapaMun) mapaMun.closePopup();
  st.ativo = null;
}

function focaItem(tipo, x, div) {
  const mesmo = st.ativo && st.ativo.x === x;
  limpaDestaque();
  if (mesmo) { moveProg(); mapaMun.fitBounds(st.area || st.enquadramento); return; }
  st.ativo = { tipo, x };
  if (div) div.classList.add("ativa");
  if (tipo === "ponto") {
    const mk = st.listaMarcadores[st.listas.pontos.indexOf(x)];
    if (mk && mk.getElement()) mk.getElement().classList.add("ativo");
  }
  if (tipo === "via") {
    if (!x.hex.length) return;
    const b = L.latLngBounds([]);
    x.hex.forEach(id => h3.cellToBoundary(id).forEach(p => b.extend(p)));
    moveProg();
    mapaMun.fitBounds(b, { maxZoom: 15, padding: [20, 20] });
    redesenhaDestaque(true);
  } else if (x.lat != null) {
    const popup = redesenhaDestaque(true);  // abre antes de mover o mapa, para medir a altura
    centraLocal([x.lat, x.lon], tipo === "ponto" ? 17 : 14, popup);
  }
}

// põe o local abaixo do centro do mapa, o suficiente para o popup (com a imagem) caber acima dele
function centraLocal(latlng, z, popup) {
  const H = mapaMun.getSize().y;
  const acima = popup ? popup.getElement().offsetHeight + 36 : 0;  // + ponta do popup e margem
  const y = Math.min(H - 30, Math.max(H / 2, acima));
  moveProg();
  mapaMun.setView(mapaMun.unproject(mapaMun.project(latlng, z).subtract([0, y - H / 2]), z), z);
}

function redesenhaDestaque(comPopup) {
  if (st.camadaDestaque) { st.camadaDestaque.remove(); st.camadaDestaque = null; }
  const a = st.ativo;
  if (!a) return;
  const x = a.x;
  if (a.tipo === "via") {
    const res = resolucao(mapaMun.getZoom());
    const ids = res === 9 ? x.hex : [...new Set(x.hex.map(id => h3.cellToParent(id, res)))];
    st.camadaDestaque = L.featureGroup(ids.map(id => L.polygon(h3.cellToBoundary(id), { color: COR.tinta, weight: 2, fill: false, interactive: false }))).addTo(mapaMun);
    return;
  }
  if (x.lat == null) return;
  const c = L.circle([x.lat, x.lon], { radius: a.tipo === "ponto" ? 55 : 500, color: COR.tinta, weight: 2.5, fill: false, interactive: false });
  st.camadaDestaque = L.featureGroup([c]).addTo(mapaMun);
  if (!comPopup) return;
  const w = Math.min(300, mapaMun.getSize().x - 60), h = Math.round(w * 0.5);  // cabe no mapa do celular
  const imagem = temImagem(x) ? `<div class="imagem-local">` +
    (CHAVE_GOOGLE ? `<div class="segmentado pequeno vista-local" role="group" aria-label="Imagem do local">` +
      `<button type="button" data-v="sat">Satélite</button><button type="button" data-v="rua">Street View</button></div>` : "") +
    `<div class="vista" data-v="sat">${miniatura(a.tipo, x, w, h, "Imagem de satélite: " + x.nome)}</div>` +
    `<div class="creditos"><a href="${linkStreetView(x.lat, x.lon)}" target="_blank" rel="noopener">Abrir no Google Maps ↗</a>` +
    `<span class="credito-img">Imagem: Esri, Maxar</span></div></div>` : "";
  const P = periodo();
  const extra = [`${fmt(x.pct_moto)}% com moto`].concat(x.pct_ped != null ? [`${fmt(x.pct_ped)}% com pedestre`] : []);
  // as vias registradas e a coordenada repetida são contadas em todos os anos
  const popup = `<h4>${esc(x.nome)}</h4>${imagem}` +
    `<div class="numeros"><div><b>${fmt(x.n)}</b><span>sinistros com vítimas</span></div><div><b>${fmt(x.mortes)}</b><span>${x.mortes === 1 ? "morte" : "mortes"}</span></div>` +
    `<div><b>${fmt(x.graves)}</b><span>feridos graves</span></div></div>` +
    `<div class="linha-det">${extra.join(" · ")} · ${P.texto}</div>` + barrasAno(x.a, w) +
    (x.vias && x.vias.length ? `<div class="vias-reg"><b>Vias registradas</b>${x.vias.map(([n, k]) => esc(n) + (P.todo ? ` (${fmt(k)})` : "")).join("<br>")}</div>` : "") +
    (x.aproximado ? `<div class="aviso">${P.todo ? "" : `Desde ${st.estado.ano_ini}, `}${fmt(x.pct_mesma_coord)}% destes sinistros estão numa única coordenada; a localização pode ser aproximada.</div>` : "");
  const box = el("div", { className: "popup" }, popup);
  if (CHAVE_GOOGLE && temImagem(x)) alternaVista(box, x, w, h);
  // mapas baixos (celular): o popup rola em vez de sair do mapa
  return L.popup({ offset: [0, -4], autoPan: false, maxWidth: w, maxHeight: mapaMun.getSize().y - 100 }).setLatLng([x.lat, x.lon]).setContent(box).openOn(mapaMun);
}

// sinistros com vítimas por ano num local (popup), com os anos do período escolhido em destaque
function barrasAno(a, w) {
  const anos = st.mun.anos, P = periodo(), { parcial, mesFim } = anosDados();
  const v = anos.map((_, i) => a.n ? a.n[i] : 0), max = Math.max(1, ...v);
  const H = 66, cima = 14, base = 15, bw = w / anos.length, lb = Math.min(20, bw * 0.62);
  const barras = v.map((n, i) => {
    const h = (H - cima - base) * n / max, x = i * bw + (bw - lb) / 2, y = H - base - h;
    const fora = i < P.idx[0] || i > P.idx[1], incompleto = parcial && i === anos.length - 1;
    return `<path d="${barraV(x, y, lb, h, 3)}" fill="${COR.sin}" fill-opacity="${(fora ? 0.28 : 1) * (incompleto ? 0.55 : 1)}"/>` +
      (n ? `<text x="${x + lb / 2}" y="${y - 3}" text-anchor="middle" font-size="10" fill="${fora ? COR.mudo : COR.tinta2}">${fmt(n)}</text>` : "") +
      `<text x="${x + lb / 2}" y="${H - 3}" text-anchor="middle" font-size="9.5" fill="${COR.mudo}">${anos[i]}${incompleto ? "*" : ""}</text>`;
  }).join("");
  return `<div class="por-ano"><b>Sinistros com vítimas por ano</b>` +
    `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Sinistros com vítimas por ano: ${anos.map((ano, i) => `${ano}, ${v[i]}`).join("; ")}">${barras}</svg>` +
    (parcial ? `<span class="nota-ano">* ${anos.at(-1)}: até ${MESES[mesFim - 1]}</span>` : "") + `</div>`;
}

// satélite ou Street View no popup; o Street View só é carregado quando pedido, e a escolha vale para os próximos locais
function alternaVista(box, x, w, h) {
  const sat = box.querySelector(".vista"), credito = box.querySelector(".credito-img");
  let rua = null;
  const mostra = v => {
    st.vistaLocal = v;
    box.querySelectorAll(".vista-local button").forEach(b => b.classList.toggle("ativo", b.dataset.v === v));
    if (v === "rua" && !rua) {
      rua = el("div", { className: "vista" }, `<iframe src="${embedStreetView(x.lat, x.lon)}" width="${w}" height="${h}" ` +
        `title="Street View: ${esc(x.nome)}" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`);
      sat.after(rua);
    }
    sat.hidden = v === "rua";
    if (rua) rua.hidden = v !== "rua";
    credito.textContent = v === "rua" ? "Imagem: Google" : "Imagem: Esri, Maxar";
  };
  box.querySelectorAll(".vista-local button").forEach(b => b.addEventListener("click", () => mostra(b.dataset.v)));
  mostra(st.vistaLocal);
}

function quemMorre(m) {
  const P = periodo(), modo = k => somaP(m.por_ano.modo[k], P.idx), est = pctModoEstado(P);
  const tot = Object.keys(m.por_ano.modo).reduce((a, k) => a + modo(k), 0);
  const itens = tot ? GRUPOS_MODO.map(([nome, ks]) => {
    const n = ks.reduce((a, k) => a + modo(k), 0);
    return { nome, n, mun: 100 * n / tot, est: ks.reduce((a, k) => a + est[k], 0) };
  }) : [];
  grafQuem($("graf-quem"), itens);
  if (tot && tot < 20) $("graf-quem").appendChild(el("p", { className: "nota", textContent: `Apenas ${plural(tot, "morte", "mortes")}: as porcentagens variam muito.` }));
}

// ------------------------------------------------------------------ vistas e rotas

function mostraVista(v) {
  if (st.vista === v) return;
  if (st.vista === "estado") st.rolagemEstado = scrollY;
  st.vista = v;
  $("vista-estado").hidden = v !== "estado";
  $("vista-municipio").hidden = v !== "municipio";
  escondeDica();
  if (v === "estado") {
    document.title = "Onde acontecem os sinistros de trânsito em São Paulo";
    if (!st.estadoDesenhado) { st.estadoDesenhado = true; desenhaGraficosEstado(); }
    garanteMapaEstado();
  } else if (mapaMun) { moveProg(); mapaMun.invalidateSize(); }
}

function rota() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (/^\d{7}$/.test(h)) {
    const jaAberto = st.mun && st.mun.cod === h;
    const vinhaDoEstado = st.vista !== "municipio";
    mostraVista("municipio");
    if (!jaAberto) abreMunicipio(h);
    else if (st.focoPendente) aplicaFoco();
    else if (vinhaDoEstado) { cabecalhoMunicipio(h); scrollTo(0, 0); }
    return;
  }
  if (h === "sobre") {  // o rodapé vale para as duas vistas
    if (!st.vista) mostraVista("estado");
    $("sobre").scrollIntoView();
    return;
  }
  const voltando = st.vista === "municipio";
  mostraVista("estado");
  const alvo = h && h !== "inicio" ? $(h) : null;
  if (alvo && alvo.closest("#vista-estado")) alvo.scrollIntoView();
  else if (h === "inicio" || !voltando) scrollTo(0, 0);
  else scrollTo(0, st.rolagemEstado || 0);
}

// ------------------------------------------------------------------ início

FONTE = getComputedStyle(document.body).fontFamily;
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
document.querySelectorAll("[data-busca]").forEach(criaBusca);
document.querySelectorAll(".abas button").forEach(b => b.addEventListener("click", () => trocaAba(b.dataset.aba)));
segmentado("seg-indicador", v => { st.indicador = v; desenhaEstado(); });
segmentado("seg-mapa", v => { st.modoMapa = v; if (st.mun) desenhaHex(); });
segmentado("seg-hora", v => { st.hora = v; if (st.mun) horaDia(st.mun); });
segmentado("seg-locais-tipo", v => { st.locaisTipo = v; st.nLocais = 10; tabelaLocais(); });
segmentado("seg-locais-ordem", v => { st.locaisOrdem = v; st.nLocais = 10; tabelaLocais(); });
$("mais-locais").addEventListener("click", () => { st.nLocais = Math.min(50, st.nLocais + 15); tabelaLocais(); });
$("filtra-area").addEventListener("click", () => {
  const b = mapaMun.getBounds();
  if (b.contains(contornoMun.getBounds())) limpaArea(); else defineArea(b);
});
$("limpa-area").addEventListener("click", () => limpaArea());
addEventListener("keydown", ev => {
  if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    ev.preventDefault(); document.querySelector(".topo .busca input").focus();
  }
});
let larguraAnterior = innerWidth;
addEventListener("resize", debounce(() => {
  if (innerWidth === larguraAnterior) return;
  larguraAnterior = innerWidth;
  if (st.vista === "estado") desenhaGraficosEstado();
  else if (st.mun) desenhaGraficosMun(st.mun);
}, 150));

fetch("data/estado.json", { cache: "no-cache" }).then(r => r.json()).then(e => {
  st.estado = e;
  iniciaEstado();
  capa();
  historias();
  tabelaLocais();
  addEventListener("hashchange", rota);
  rota();
});
