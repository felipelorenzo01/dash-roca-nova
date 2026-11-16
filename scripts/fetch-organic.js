#!/usr/bin/env node
/* Busca os números orgânicos do Instagram da Roça Nova (API oficial da Meta) e grava organic.json.
 *
 * Variáveis de ambiente:
 *   IG_TOKEN       token do usuário do sistema (obrigatório, guardado como secret no GitHub)
 *   IG_USER_ID     ID da conta do Instagram (padrão: 17841419982796667 = @roca_nova)
 *   GRAPH_VERSION  versão da API (padrão: v23.0)
 *   DAYS           quantos dias para trás buscar na primeira vez (padrão: 90)
 *   REFRESH_DAYS   quantos dias recentes são sempre refeitos (padrão: 4)
 *
 * Roda todo dia pelo GitHub Actions (.github/workflows/organico.yml).
 * Só leitura: nenhuma chamada altera a conta. */
"use strict";
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.IG_TOKEN;
const IG = process.env.IG_USER_ID || "17841419982796667";
const V = process.env.GRAPH_VERSION || "v23.0";
const DAYS = +process.env.DAYS || 90;
const REFRESH = +process.env.REFRESH_DAYS || 4;
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "organic.json");
const THUMBS = path.join(ROOT, "thumbs", "org");
if (!TOKEN) { console.error("PROBLEMA: falta a variável IG_TOKEN (secret do GitHub)."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `https://graph.facebook.com/${V}`;

async function api(p, params = {}, tries = 3) {
  const u = new URL(p.startsWith("http") ? p : `${BASE}/${p}`);
  if (!p.startsWith("http")) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  for (let i = 1; i <= tries; i++) {
    const r = await fetch(u);
    const j = await r.json().catch(() => ({}));
    if (r.ok && !j.error) return j;
    const e = j.error || { message: "HTTP " + r.status };
    // token inválido/expirado ou sem permissão: não adianta tentar de novo
    if (e.code === 190 || e.code === 10 || e.code === 200) { const x = new Error(`Token recusado pela Meta (código ${e.code}): ${e.message}`); x.fatal = true; throw x; }
    if (i === tries || (e.code !== 1 && e.code !== 2 && e.code !== 4 && e.code !== 17 && e.code !== 32 && r.status < 500)) { const x = new Error(e.message || "erro"); x.code = e.code; x.sub = e.error_subcode; throw x; }
    await sleep(1500 * i);
  }
}

const pad = (n) => String(n).padStart(2, "0");
const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addD = (s, k) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return isoUTC(d); };
// "hoje" no fuso de Brasília (-03:00)
const today = isoUTC(new Date(Date.now() - 3 * 3600 * 1000));
const yesterday = addD(today, -1);

/* total_value de várias métricas num intervalo; se alguma métrica não existir, tenta uma a uma */
async function totals(metrics, since, until) {
  const out = {};
  const run = async (list) => {
    const j = await api(`${IG}/insights`, { metric: list.join(","), metric_type: "total_value", period: "day", since, until });
    for (const m of j.data || []) out[m.name] = (m.total_value && m.total_value.value) || 0;
  };
  try { await run(metrics); }
  catch (e) {
    if (e.fatal) throw e;
    for (const m of metrics) { try { await run([m]); } catch (e2) { if (e2.fatal) throw e2; } }
  }
  return out;
}

/* série diária (reach e follower_count), em blocos de até 30 dias */
async function series(metric, since, until) {
  const res = {};
  for (let a = since; a <= until; a = addD(a, 30)) {
    let b = addD(a, 29); if (b > until) b = until;
    try {
      const j = await api(`${IG}/insights`, { metric, period: "day", since: a, until: addD(b, 1) });
      for (const m of j.data || []) for (const v of m.values || []) res[addD(String(v.end_time).slice(0, 10), -1)] = v.value; // end_time marca o fim do dia (00:00 do dia seguinte)
    } catch (e) { if (e.fatal) throw e; console.warn(`aviso: ${metric} ${a}..${b}: ${e.message}`); }
  }
  return res;
}

const DAY_METRICS = ["views", "total_interactions", "accounts_engaged", "likes", "comments", "shares", "saves", "profile_links_taps", "profile_views"];
const COLS = ["reach", "views", "interactions", "follows", "engaged", "likes", "comments", "shares", "saves", "visits", "linkTaps"];

(async () => {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const rows = new Map(); // data -> objeto
  if (prev && Array.isArray(prev.daily)) for (const r of prev.daily) { const o = { d: r[0] }; COLS.forEach((c, i) => (o[c] = r[i + 1])); rows.set(r[0], o); }

  // conta
  const acc = await api(IG, { fields: "username,name,followers_count,follows_count,media_count" });
  console.log(`Conta: @${acc.username} · ${acc.followers_count} seguidores`);

  // período a buscar: tudo que falta nos últimos DAYS + os últimos REFRESH dias sempre refeitos
  const first = addD(yesterday, -(DAYS - 1));
  const need = [];
  for (let d = first; d <= yesterday; d = addD(d, 1)) if (!rows.has(d) || d > addD(yesterday, -REFRESH)) need.push(d);
  console.log(`Dias a buscar: ${need.length} (${need[0] || "-"} a ${need[need.length - 1] || "-"})`);

  // alcance diário e novos seguidores por dia (follower_count só guarda ~30 dias)
  const from = need[0] || yesterday;
  const reach = need.length ? await series("reach", from, yesterday) : {};
  const folFrom = from < addD(yesterday, -29) ? addD(yesterday, -29) : from; // follower_count só existe para ~30 dias
  const fol = need.length ? await series("follower_count", folFrom, yesterday) : {};

  // demais métricas: uma chamada por dia
  for (const d of need) {
    const t = await totals(DAY_METRICS, d, addD(d, 1));
    const o = rows.get(d) || { d };
    o.reach = reach[d] != null ? reach[d] : (o.reach || 0);
    o.views = t.views || 0; o.interactions = t.total_interactions || 0; o.engaged = t.accounts_engaged || 0;
    o.likes = t.likes || 0; o.comments = t.comments || 0; o.shares = t.shares || 0; o.saves = t.saves || 0;
    o.visits = t.profile_views || 0; o.linkTaps = t.profile_links_taps || 0;
    o.follows = fol[d] != null ? fol[d] : (o.follows || 0);
    rows.set(d, o);
    await sleep(120);
  }

  // alcance de contas únicas nos períodos fixos (a soma diária conta a mesma pessoa várias vezes)
  const uniq = {};
  for (const n of [7, 14, 30]) {
    try { const t = await totals(["reach"], addD(yesterday, -(n - 1)), addD(yesterday, 1)); if (t.reach != null) uniq[n] = t.reach; } catch (e) { if (e.fatal) throw e; }
  }

  // posts dos últimos DAYS dias com métricas
  const posts = [];
  let url = `${IG}/media`, params = { fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: 50 };
  let page = 0;
  while (url && page < 6) {
    const j = await api(url, params); params = {}; page++;
    for (const m of j.data || []) posts.push(m);
    const lastP = (j.data || []).slice(-1)[0];
    if (lastP && isoUTC(new Date(new Date(lastP.timestamp).getTime() - 3 * 3600 * 1000)) < first) break;
    url = j.paging && j.paging.next ? j.paging.next : null;
  }
  fs.mkdirSync(THUMBS, { recursive: true });
  const outPosts = [];
  for (const m of posts) {
    const date = isoUTC(new Date(new Date(m.timestamp).getTime() - 3 * 3600 * 1000));
    if (date < first) continue;
    const isReel = m.media_product_type === "REELS";
    const list = isReel ? ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"] : ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"];
    let ins = {};
    const run = async (ms) => { const j = await api(`${m.id}/insights`, { metric: ms.join(",") }); for (const x of j.data || []) ins[x.name] = (x.values && x.values[0] && x.values[0].value) || 0; };
    try { await run(list); } catch (e) { if (e.fatal) throw e; for (const k of list) { try { await run([k]); } catch (e2) { if (e2.fatal) throw e2; } } }
    // miniatura (as URLs da Meta expiram, por isso guardamos uma cópia)
    let thumb = null;
    const src = m.thumbnail_url || (m.media_type === "IMAGE" || m.media_type === "CAROUSEL_ALBUM" ? m.media_url : null);
    if (src) {
      const f = path.join(THUMBS, m.id + ".jpg");
      if (!fs.existsSync(f)) { try { const r = await fetch(src); if (r.ok) fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } catch (e) {} }
      if (fs.existsSync(f)) thumb = "thumbs/org/" + m.id + ".jpg";
    }
    const type = isReel ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : m.media_type === "VIDEO" ? "Vídeo" : "Foto";
    outPosts.push({
      id: m.id, date, type, url: m.permalink, thumb,
      caption: String(m.caption || "").replace(/\s+/g, " ").slice(0, 140),
      reach: ins.reach || 0, views: ins.views || 0, likes: ins.likes != null ? ins.likes : m.like_count || 0,
      comments: ins.comments != null ? ins.comments : m.comments_count || 0, shares: ins.shares || 0, saves: ins.saved || 0,
      interactions: ins.total_interactions || 0,
    });
    await sleep(120);
  }
  outPosts.sort((a, b) => (a.date < b.date ? 1 : -1));

  const days = [...rows.keys()].sort().slice(-400);
  if (!days.length) { console.error("PROBLEMA: a Meta não devolveu nenhum dia de dados."); process.exit(1); }
  const out = {
    updatedAt: new Date().toISOString(),
    account: { username: acc.username, followers: acc.followers_count, following: acc.follows_count, media: acc.media_count },
    cols: COLS, firstDay: days[0], lastDay: days[days.length - 1], uniqueReach: uniq,
    daily: days.map((d) => [d].concat(COLS.map((c) => rows.get(d)[c] || 0))),
    posts: outPosts,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const sum = (c) => days.slice(-30).reduce((s, d) => s + (rows.get(d)[c] || 0), 0);
  console.log(`organic.json: ${days.length} dias, ${outPosts.length} posts. Últimos 30 dias: alcance(soma) ${sum("reach")}, views ${sum("views")}, interações ${sum("interactions")}, novos seguidores ${sum("follows")}.`);
})().catch((e) => { console.error((e.fatal ? "PROBLEMA: " : "ERRO: ") + e.message); process.exit(1); });
