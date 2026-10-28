#!/usr/bin/env node
// Converte o retorno do conector "MCP - Meta" (ads_get_ad_entities) no data.json do painel.
// Uso: node scripts/build-data.js <pasta-raw>
// A pasta precisa ter: adsets.json, demo.json, ads.json (arrays de ad_entities)
// e, opcionalmente, previews.json ({ "<nome do criativo>": { "url": "...", "thumb": "thumbs/x.jpg" } }).
"use strict";
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config.json");

const dir = process.argv[2] || "raw";
const read = (f, fallback) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; };
const adsetsRaw = read("adsets.json", []);
const demoRaw = read("demo.json", []);
const adsRaw = read("ads.json", []);
const previewsNew = read("previews.json", {});
const prevData = fs.existsSync("data.json") ? JSON.parse(fs.readFileSync("data.json", "utf8")) : null;

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const mv = (v) => { if (v == null) return 0; if (typeof v === "object") return "value" in v ? mv(v.value) : 0; const x = Number(v); return isFinite(x) ? x : 0; };
const r2 = (x) => Math.round(x * 100) / 100;
const visitsOf = (r) => { const x = r && r.results; if (!x || String(x.indicator || "").indexOf("profile_visit") < 0) return 0; return Array.isArray(x.values) && x.values.length ? mv(x.values[0].value) : 0; };
const cleanName = (s) => String(s || "(sem nome)").replace(/(\s*[—-]\s*C[óo]pia(\s*\d+)?)+\s*$/i, "").trim();
function cityOf(adset, campaign) {
  for (const s of [norm(adset), norm(campaign)]) {
    const toks = s.split(/[^a-z0-9]+/);
    for (const c of CONFIG.cities) {
      for (const k0 of c.keywords) {
        const k = norm(k0).trim();
        if ((k.includes(" ") || k.length > 3) ? s.includes(k) : toks.includes(k)) return c.key;
      }
    }
  }
  return null;
}
const day = (r) => String(r.date_start).slice(0, 10);
const hasData = (r) => mv(r.amount_spent) > 0 || mv(r.impressions) > 0 || mv(r.instagram_profile_follow_v2) > 0;

// Conjuntos de anúncios
const adsets = [], adsetIdx = {};
function adsetRef(id, name, campaign) {
  if (!(id in adsetIdx)) { adsetIdx[id] = adsets.length; adsets.push({ id, name, campaign: campaign || "", city: cityOf(name, campaign) }); }
  const a = adsets[adsetIdx[id]];
  if (campaign && !a.campaign) { a.campaign = campaign; a.city = cityOf(a.name, campaign); }
  return adsetIdx[id];
}
// [data, conjunto, investimento, impressões, cliques, visitas, seguidores]
const daily = adsetsRaw.filter(hasData).map((r) => [day(r), adsetRef(r.id, r.name, r.campaign_name), r2(mv(r.amount_spent)), mv(r.impressions), mv(r.link_click), visitsOf(r), mv(r.instagram_profile_follow_v2)]);
// [data, conjunto, idade, gênero, investimento, impressões, cliques, seguidores]
const demo = demoRaw.filter(hasData).map((r) => [day(r), adsetRef(r.id, r.name), r.age, r.gender, r2(mv(r.amount_spent)), mv(r.impressions), mv(r.link_click), mv(r.instagram_profile_follow_v2)]);
// Criativos agrupados pelo nome (cópias contam como o mesmo criativo)
const creatives = {}, adsByName = {};
const ads = adsRaw.filter(hasData).map((r) => {
  const name = cleanName(r.name), key = norm(name);
  const c = creatives[key] || (creatives[key] = { name, top: 0, adId: "" });
  const sp = mv(r.amount_spent); if (sp >= c.top) { c.top = sp; c.adId = r.id; }
  const asId = Object.keys(adsetIdx).find((id) => adsets[adsetIdx[id]].name === r.adset_name);
  const ai = asId != null ? adsetIdx[asId] : adsetRef("name:" + r.adset_name, r.adset_name, r.campaign_name);
  // [data, conjunto, criativo, investimento, impressões, cliques, visitas, seguidores, plays]
  return [day(r), ai, key, r2(sp), mv(r.impressions), mv(r.link_click), visitsOf(r), mv(r.instagram_profile_follow_v2), mv(r.video_play_actions)];
});
const prevCreatives = (prevData && prevData.creatives) || {};
Object.keys(creatives).forEach((k) => {
  const c = creatives[k], base = c.name.replace(/^\d+\s*-\s*/, "");
  const pv = previewsNew[c.name] || previewsNew[base] || {};
  const old = prevCreatives[k] || {};
  creatives[k] = { name: c.name, adId: c.adId, preview: pv.url || old.preview || "", thumb: pv.thumb || old.thumb || "" };
});

const dates = daily.map((r) => r[0]).sort();
const out = {
  updatedAt: new Date().toISOString(),
  account: CONFIG.account,
  cities: CONFIG.cities.map((c) => ({ key: c.key, label: c.label, uf: c.uf })),
  firstDay: dates[0] || null,
  lastDay: process.env.UNTIL || dates[dates.length - 1] || null,
  adsets, creatives, daily, demo, ads
};
fs.writeFileSync("data.json", JSON.stringify(out));
const tot = daily.reduce((t, r) => { t.s += r[2]; t.f += r[6]; t.v += r[5]; return t; }, { s: 0, f: 0, v: 0 });
console.log(`data.json: ${daily.length} linhas por dia, ${demo.length} de público, ${ads.length} de criativos, ${Object.keys(creatives).length} criativos.`);
console.log(`Período ${out.firstDay} a ${out.lastDay} · investimento R$ ${tot.s.toFixed(2)} · ${tot.v} visitas · ${tot.f} seguidores.`);
// Confere se a leitura por anúncio veio completa (a Meta corta respostas grandes sem avisar)
const spAds = ads.reduce((t, r) => t + r[3], 0);
if (tot.s > 0 && Math.abs(spAds - tot.s) > Math.max(1, tot.s * 0.02)) {
  console.log(`ATENÇÃO: criativos somam R$ ${spAds.toFixed(2)} e conjuntos R$ ${tot.s.toFixed(2)}. Refaça raw/ads.json em janelas menores (veja UPDATE.md).`);
}
const semCidade = adsets.filter((a) => !a.city).map((a) => a.name);
if (semCidade.length) console.log("Conjuntos sem praça (entram só na visão geral): " + semCidade.join(" | "));
