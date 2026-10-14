# Kart Telemetria — MVP

Sistema de telemetria para kart: **app do piloto** (Expo / React Native), **dashboard web ao vivo** para espectadores (React + Leaflet) e **servidor em tempo real** (NestJS + Socket.IO + Prisma/PostgreSQL). Inclui um **simulador de karts** para testar tudo sem celulares.

```
kart-telemetry/
├─ packages/shared     # lógica pura e testada: geodésia, linha virtual, detecção de voltas,
│                      # classificação/gaps, relatórios, sincronização de relógio, protocolo
├─ apps/server         # NestJS: REST + WebSocket, Prisma, estado da corrida em memória
├─ apps/dashboard      # React + Vite + Leaflet: mapa ao vivo, torre de classificação, relatórios
├─ apps/mobile         # Expo Router: salas, coleta GPS, painel de corrida, relatório individual
├─ tools/simulator     # karts virtuais enviando GPS (inclui perda de internet)
└─ docker-compose.yml  # PostgreSQL
```

## Como rodar

Pré-requisitos: Node ≥ 20.12, Docker (para o PostgreSQL) e o app **Expo Go** ou um *development build* no celular.

```bash
npm install                 # instala todos os workspaces (gera o Prisma Client)
npm run db:up               # sobe o PostgreSQL (porta 5432)
cp apps/server/.env.example apps/server/.env
npm run db:migrate          # cria as tabelas (prisma migrate dev --name init)
npm run server              # API + WebSocket em http://0.0.0.0:3000
npm run dashboard           # dashboard em http://localhost:5173 (proxy para o servidor)
npm run mobile              # Expo: leia o QR code com o celular
```

**Sem PostgreSQL** (demonstração rápida): descomente `DB_DRIVER=memory` em `apps/server/.env`. Os dados ficam só na memória.

**Um endereço só para tudo:** `npm run build` e depois `npm run start -w @kart/server` — o servidor também entrega o dashboard compilado em `http://IP:3000/s/CODIGO`.

### Celular

- Celular e computador precisam estar na mesma rede. O app tenta `http://<IP do Metro>:3000` automaticamente; para outro endereço use **Servidor** na tela inicial (ou `EXPO_PUBLIC_SERVER_URL`).
- Para uso real em pista, publique o servidor com HTTPS (Render, Railway, VPS…) e informe a URL no app.
- **Ver demonstração do painel** (tela inicial) mostra o painel com dados simulados, sem GPS.

### Fundo do mapa

O dashboard tem três fundos, escolhidos no canto do mapa: **Satélite** (Esri), **Mapa** (OpenStreetMap, escurecido no tema escuro) e **Só traçado**. Nenhum deles exige chave de API. Para usar um provedor com chave (MapTiler, Stadia, CARTO), copie `apps/dashboard/.env.example` para `.env`, preencha `VITE_TILE_URL_DARK`/`VITE_TILE_URL_LIGHT` e reinicie o `npm run dashboard`.

### Simulador

```bash
npm run simulate -- --karts 6 --duration 180 --offline   # cria uma sala e corre sozinho
npm run simulate -- --join ABC123 --karts 3              # adiciona karts a uma sala do celular
npm run simulate -- --karts 3 --pair --duration 180      # 2 "celulares" no mesmo kart, com relógios errados
```

`--offline` derruba a internet de um kart por 12 s para mostrar a sincronização e o aviso "posição desatualizada".

### Testes

```bash
npm test     # detecção de voltas, ruído/oscilação de GPS, outliers, gaps, retardatários, relatórios
```

## Hospedagem (produção)

O servidor mantém o estado da corrida em memória e usa WebSocket contínuo, então precisa de **um processo Node sempre ligado** (Render, Railway, Fly.io, VPS). Funções serverless (Vercel) não servem para ele. O próprio servidor entrega o dashboard, então **um único serviço** basta.

1. **Banco**: crie um PostgreSQL gratuito no [Neon](https://neon.tech) ou no [Supabase](https://supabase.com) e copie a *connection string* (no Supabase, use a do *Session pooler*, porta 5432).
2. **Servidor + dashboard (Render)**: suba o projeto para o GitHub → Render → *New → Blueprint* → escolha o repositório (usa o `render.yaml`) → preencha `DATABASE_URL`. O build roda `npm ci && npm run build`; o start roda `prisma db push` (cria as tabelas) e sobe o servidor. Teste `https://SEU-APP.onrender.com/api/health` e abra `https://SEU-APP.onrender.com`.
   - Plano gratuito: dorme após 15 min sem uso e leva ~1 min para acordar. Abra o dashboard alguns minutos antes da corrida, ou use o plano pago.
   - Use **uma única instância** (o estado da corrida fica na memória do processo).
3. **App (EAS Build)**: em `apps/mobile/eas.json`, troque a URL pela do seu servidor e rode, dentro de `apps/mobile`:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init          # vincula o projeto à sua conta Expo
   npx eas-cli@latest build -p android --profile preview   # gera um .apk para instalar
   ```
   Para testar antes do build, `EXPO_PUBLIC_SERVER_URL=https://SEU-APP.onrender.com npx expo start` com o Expo Go.
4. **Dashboard na Vercel (opcional)**: importe o repositório com *Root Directory* `apps/dashboard` (o `vercel.json` já está pronto) e defina `VITE_SERVER_URL=https://SEU-APP.onrender.com`. No app, aponte `EXPO_PUBLIC_DASHBOARD_URL` para o endereço da Vercel.

## Como funciona

### Fluxo
1. O criador toca em **Criar sala** (nome da pista, nome, total de voltas opcional) e recebe um código de 6 caracteres. Os outros entram com o código.
2. No lobby o criador posiciona o kart na linha e toca **Iniciar corrida**: a posição GPS vira o centro da **linha virtual**. Se o kart já estiver andando, o *heading* do GPS define a direção; se estiver parado, a direção é definida automaticamente quando ele se desloca 10 m.
3. Durante a corrida cada celular grava o traçado, detecta voltas localmente e envia os pontos ao servidor; o servidor recalcula tudo e transmite classificação e posições (2 Hz) para pilotos e espectadores.
4. O criador pode **redefinir a linha** (segurar o botão + confirmar): todas as voltas de todos os pilotos são recalculadas com a linha nova.
5. **Encerrar** congela o relatório geral (dashboard) e cada celular abre o relatório individual. Tudo fica salvo e acessível no histórico do app e em `/s/CODIGO/report`.

### Detecção de voltas (`packages/shared/src/lapDetector.ts`)
- Linha = segmento perpendicular ao sentido de corrida (meia-largura 15 m). Cada par de pontos consecutivos é projetado num referencial local em metros.
- Conta só cruzamentos **no sentido de corrida** e dentro da largura da linha.
- O instante é **interpolado** entre as duas amostras → precisão sub-amostra (ms).
- Contra oscilação do GPS: filtro de precisão (> 30 m descarta), filtro de saltos impossíveis (> 200 km/h), **histerese** (após cruzar, só rearma a 25 m da linha), tempo mínimo de volta (10 s) e distância mínima (100 m).
- O mesmo código roda no celular (cronômetro funciona offline) e no servidor (fonte oficial). Sendo determinístico, os resultados coincidem.
- A incerteza de cada passagem é estimada (erro de posição ÷ velocidade) e mostrada nos relatórios.

### Três métricas diferentes
| Métrica | Definição |
|---|---|
| Tempo de volta | intervalo entre duas passagens do mesmo piloto |
| Gap de corrida (intervalo) | diferença entre os instantes em que dois pilotos passaram pela linha na **mesma volta** |
| Distância física | metros em linha reta até o kart à frente (mostrada no dashboard) |

Classificação: mais voltas completadas primeiro; empate → quem passou antes pela linha. O líder vê a vantagem para o 2º. Retardatários aparecem como "+1 VOLTA".

### Precisão do GPS (filtro de Kalman)
O GPS do celular erra a **posição** em 3–10 m, mas a **velocidade** (medida por efeito Doppler) erra só ~0,1–0,5 m/s. O detector funde as duas num filtro de Kalman (`packages/shared/src/kalman.ts`), descarta saltos de multipercurso e só então procura a passagem pela linha. O traçado desenhado no mapa e nos relatórios passa também pela suavização de ida e volta (RTS), por isso não "serpenteia".

Limite físico: 3 m de erro ao longo da pista equivalem a ~0,2 s a 15 m/s. Nos testes com ruído realista de celular, o erro típico de tempo de volta fica em ~0,2 s. Para chegar a ~0,05 s é preciso um receptor GNSS externo de 10–25 Hz (ex.: RaceBox), que entra como nova fonte de `GpsSample`.

### Ordem e gap ao vivo
Depois da primeira volta, o servidor tem o traçado de referência do circuito e projeta cada kart sobre ele (`progress.ts`). A ordem e o intervalo passam a ser **contínuos**: o gap é "quanto tempo depois do kart da frente eu passei por este ponto da pista", atualizado 2× por segundo — não só na linha de chegada. O resultado oficial continua medido nas passagens pela linha.

### Relógio e conexão
- O horário de cada fix é convertido para o relógio do celular (o sistema de localização pode usar a hora do GPS, e o relógio do celular pode estar dezenas de segundos errado — `fixTime.ts`).
- Os celulares sincronizam o relógio com o servidor (estilo NTP, mediana das amostras de menor latência) — o gap compara instantes medidos em aparelhos diferentes.
- Cada ponto tem um `seq`. O celular guarda uma fila persistente (AsyncStorage) e só descarta o que o servidor confirmou; ao reconectar, reenvia o restante. Pontos atrasados são reprocessados e a classificação se corrige sozinha.
- Sem pontos há 5 s, o dashboard marca o kart como **sem sinal / posição desatualizada**.

### Segurança do piloto
Tela sempre ligada, números grandes, modo paisagem para suporte no volante, **aviso por voz** a cada volta ("Volta 3. 41 ponto 9. Posição 2") e vibração. Ações do criador exigem **segurar o botão** e confirmar.

## API

| REST | |
|---|---|
| `POST /api/sessions` | `{trackName, pilotName, targetLaps?}` → sala + piloto + token |
| `POST /api/sessions/:code/join` | `{pilotName}` |
| `GET /api/sessions` / `GET /api/sessions/:code` | lista / estado |
| `GET /api/sessions/:code/report` | relatório geral |
| `GET /api/sessions/:code/pilots/:id/report` | relatório individual |
| `GET /api/sessions/:code/pilots/:id/trace?lap=n` | traçado suavizado (`&raw=1` para os pontos brutos) |

Eventos Socket.IO estão em `packages/shared/src/protocol.ts` (`pilot:join`, `points:batch`, `race:start`, `race:line:reset`, `race:finish`, `live:positions`, `live:standings`, `live:lap`, `session:finished`…).

## Limitações conhecidas do MVP
- **GPS só em primeiro plano**: a tela fica ligada durante a corrida. Coleta com tela bloqueada exige `TaskManager` + serviço em primeiro plano (development build).
- Celulares típicos entregam 1 Hz no iOS e até ~5 Hz no Android, com erro de 3–10 m. A interpolação compensa bem, mas a incerteza real é da ordem de dezenas a centenas de ms.
- Os karts devem largar **atrás** da linha (o criador pode estar sobre ela).
- O gap só é atualizado nas passagens pela linha (como no intervalo oficial); análise por setores refinaria isso.
- Sem autenticação de usuário: o token do piloto protege apenas as ações daquela sala.

## Próximos passos (pontos de extensão)
- **Sensores externos**: novas fontes produzem `GpsSample` — o detector não muda.
- **Análise por setores**: várias linhas virtuais reutilizando `segmentCrossesLine`.
- **Replay e comparação de trajetórias**: os pontos brutos já ficam em `GpsPoint` (endpoint `trace`).
- **Rankings por pista**: as pistas são reutilizadas pelo nome (`Track`), basta agregar `Lap` por `trackId`.
