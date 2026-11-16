# Painel Roça Nova

Painel de campanhas de Meta Ads da banda Roça Nova: investimento, visitas ao perfil e seguidores, com visão geral e abas por praça, seletor de período e comparação entre períodos.

- `index.html`: o painel. Busca os números em `data.json`.
- `data.json`: dados diários dos últimos 90 dias, gerados por `scripts/build-data.js`.
- `thumbs/`: imagens dos criativos.
- `UPDATE.md`: roteiro da atualização automática (todo dia às 7h).

Deploy: repositório conectado ao Vercel. Cada push publica a nova versão.

## Aba Orgânico (Instagram)

- `organic.json`: números orgânicos do @roca_nova (alcance, visualizações, interações, novos seguidores, visitas ao perfil e posts), gerados por `scripts/fetch-organic.js`.
- `thumbs/org/`: miniaturas dos posts.
- `.github/workflows/organico.yml`: GitHub Actions que roda todo dia às 06:40 (Brasília) e também pode ser disparado à mão (aba Actions). Usa o secret `IG_TOKEN` (token de usuário do sistema da Meta, só leitura). Se o token vencer ou for revogado, a execução falha e o GitHub avisa por e-mail.
