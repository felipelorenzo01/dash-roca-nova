# Painel Roça Nova

Painel de campanhas de Meta Ads da banda Roça Nova: investimento, visitas ao perfil e seguidores, com visão geral e abas por praça, seletor de período e comparação entre períodos.

- `index.html`: o painel. Busca os números em `data.json`.
- `data.json`: dados diários dos últimos 90 dias, gerados por `scripts/build-data.js`.
- `thumbs/`: imagens dos criativos.
- `UPDATE.md`: roteiro da atualização automática (todo dia às 7h e às 17h).

Deploy: repositório conectado ao Vercel. Cada push publica a nova versão.
