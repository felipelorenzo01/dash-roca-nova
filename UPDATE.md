# Como atualizar os dados do painel

Este roteiro é seguido pela tarefa agendada do Claude, todo dia às 7h e às 17h (horário de Brasília). Ele também serve pra rodar à mão.

## 1. Buscar os dados na Meta

Use o conector **"MCP - Meta"**, ferramenta `ads_get_ad_entities`, na conta `1031511192155613`.
- Em todas as chamadas, mande o mesmo `client_conversation_id` (20 caracteres aleatórios) e `include_additional_context: false`.
- Período: `time_range` dos últimos 90 dias até hoje, no fuso de Brasília. Exemplo: `{"since":"AAAA-MM-DD","until":"AAAA-MM-DD"}`.
- Filtro em todas: `[{"field":"amount_spent","operator":"GREATER_THAN","value":["0"]}]`.

Faça as três chamadas abaixo. Salve o campo `ad_entities` de cada resposta, que vem como texto JSON, na pasta `raw/`. Se a resposta for grande e cair num arquivo, extraia com `jq -r '.ad_entities'`. Se vier `pagination.next_cursor`, repita a chamada com `cursor` e junte as listas.

| Arquivo | level | time_increment | breakdowns | fields |
|---|---|---|---|---|
| `raw/adsets.json` | adset | "1" | — | id, name, campaign_name, amount_spent, impressions, link_click, results, instagram_profile_follow_v2 |
| `raw/demo.json` | adset | "1" | ["age","gender"] | id, name, amount_spent, impressions, link_click, instagram_profile_follow_v2 |
| `raw/ads.json` | ad | "1" | — | id, name, campaign_name, adset_name, amount_spent, impressions, link_click, results, instagram_profile_follow_v2, video_play_actions |

Use `limit: 1000` nas três.

## 2. Prévias dos criativos

Rode `node scripts/build-data.js raw` uma primeira vez. Depois, para cada criativo de `data.json` → `creatives` (são poucos), chame `ads_get_ad_preview` com o `adId` do criativo e `ad_format: "INSTAGRAM_STORY"`.
- Guarde o `preview_url`, trocando `&amp;` por `&`.
- Se o criativo ainda não tiver `thumb`, a resposta traz uma imagem do anúncio. Reduza essa imagem para 300 px de largura, em JPG com qualidade 72, e salve em `thumbs/<nome-do-criativo-em-minusculas-com-hifens>.jpg`.

Escreva `raw/previews.json` neste formato:

```json
{ "02 - Itabirito": { "url": "https://business.facebook.com/ads/api/preview_iframe.php?...", "thumb": "thumbs/itabirito.jpg" } }
```

## 3. Gerar o data.json e publicar

```bash
UNTIL=<hoje AAAA-MM-DD> node scripts/build-data.js raw
git add data.json thumbs
git commit -m "Atualiza dados $(date +%d/%m\ %H:%M)"
git push
```

A pasta `raw/` não vai para o repositório. O Vercel publica sozinho a cada push.

## Praças

As praças e as palavras que identificam cada uma estão em `scripts/config.json`. A praça é reconhecida pelo nome do conjunto de anúncios (ou da campanha). Conjunto que não bate com nenhuma praça entra só na visão geral, e o script avisa no final.
