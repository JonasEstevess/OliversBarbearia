# Oliver's Barbearia

Site de agendamento online da **Oliver's Barbearia** — R. Serra dos Dois Irmãos, 474, Jardim Amália, São Paulo/SP.

## Funcionalidades

- **Landing page** com rolagem suave, animações de entrada, cardápio de serviços com preços, equipe, galeria, horários e mapa.
- **Agendamento em 4 passos**: serviço → profissional (ou "primeiro disponível") → data e hora → confirmação.
  - Só mostra horários realmente livres, respeitando expediente, intervalo de almoço, duração do serviço e agenda de cada barbeiro.
  - Proteção contra dois clientes reservarem o mesmo horário ao mesmo tempo.
  - Após confirmar: adicionar ao calendário (.ics) e avisar no WhatsApp.
- **Login e cadastro** de clientes (e-mail, WhatsApp e senha).
- **Minha conta** (`/conta`): próximo horário, histórico, cancelar (até 2h antes) e "repetir" um serviço.
- **Painel da barbearia** (`/painel`): agenda do dia por barbeiro, faturamento previsto, concluir / faltou / cancelar e atalho para chamar o cliente no WhatsApp.

## Stack

- Node.js 22.13+ (usa o `node:sqlite` nativo)
- Express 4
- SQLite (arquivo em `data/olivers.db`, criado automaticamente)
- Front-end em HTML, CSS e JavaScript puros (sem build), com [Lenis](https://github.com/darkroomengineering/lenis) para a rolagem suave

## Como rodar

```bash
npm install
cp .env.example .env   # edite ADMIN_EMAIL e ADMIN_PASSWORD
npm run dev
```

Acesse http://localhost:3000. A conta de administrador do `.env` é criada na primeira execução; entre com ela e acesse `/painel`.

## Estrutura

```
server/
  index.js          # app express, segurança e rotas
  catalog.js        # serviços, preços, barbeiros e horários
  availability.js   # cálculo de horários livres
  auth.js           # senhas (scrypt), sessões e permissões
  db.js             # esquema SQLite
  routes/           # auth, agendamento e admin
public/
  index.html        # landing + agendamento
  conta.html        # área do cliente
  painel.html       # painel da barbearia
  css/ js/
```

## Editando serviços, preços e horários

Tudo fica em [`server/catalog.js`](server/catalog.js). Os preços estão em centavos (`4000` = R$ 40,00).

## Convenções

- Commits seguem o padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat:`, `fix:`, `docs:`, `chore:`…).
- Cada funcionalidade é feita em sua própria branch (`feat/...`, `fix/...`) e integrada na `main` com merge `--no-ff`.

## Publicação

Em produção, defina `NODE_ENV=production` (os cookies passam a exigir HTTPS) e use um host com disco persistente para o arquivo SQLite (ex.: Railway, Render com disco, Fly.io ou uma VPS).
