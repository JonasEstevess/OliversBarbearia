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
  - **Bloqueios:** folgas, feriados e compromissos por barbeiro ou da barbearia inteira, por horário ou dia inteiro (também por período). Avisa se já havia clientes marcados.
  - **Clientes:** busca por nome, e-mail ou WhatsApp e geração de **link de nova senha** (válido por 24h, uso único) enviado pelo WhatsApp.
- **Notificações push** (site, app Android e app do iPhone instalado):
  - A barbearia recebe um aviso a cada agendamento ou cancelamento.
  - O cliente recebe um lembrete no dia do horário (8h) e um aviso se a barbearia cancelar.
  - As chaves são geradas automaticamente e ficam no banco; não há nada para configurar.
- **LGPD:** página `/privacidade`, aceite obrigatório no cadastro e exclusão da conta e de todos os dados pelo próprio cliente.

## Stack

- Node.js 20+
- Express 4
- SQLite via [libSQL](https://github.com/tursodatabase/libsql-client-ts): arquivo local `data/olivers.db` em desenvolvimento e [Turso](https://turso.tech) em produção
- Front-end em HTML, CSS e JavaScript puros (sem build), com [Lenis](https://github.com/darkroomengineering/lenis) para a rolagem suave

## Como rodar

```bash
npm install
cp .env.example .env   # edite ADMIN_EMAIL e ADMIN_PASSWORD
npm run dev
```

Acesse http://localhost:3000. A conta de administrador do `.env` é criada na primeira execução; entre com ela e acesse `/painel`.

### Primeiro acesso ao painel (sem `.env`)

Se `ADMIN_EMAIL`/`ADMIN_PASSWORD` não estiverem definidos, o painel mostra a tela **Criar conta da barbearia**. Ela pede um **código de configuração** de uso único, que o servidor escreve nos logs (na Vercel: *Logs*, linha `[CONFIGURAÇÃO INICIAL]`). Depois que o primeiro administrador é criado, essa tela deixa de existir.

## Estrutura

```
api/
  index.js          # função serverless da Vercel (reaproveita o app)
server/
  app.js            # app express, segurança e rotas
  index.js          # servidor local (npm run dev)
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

## Aplicativo Android

O app é um **TWA** (Trusted Web Activity) gerado pelo [PWABuilder](https://www.pwabuilder.com): abre o site em tela cheia, sem barra do navegador, e recebe toda atualização do site na hora.

- **Página de instalação:** `/app`, que detecta Android, iPhone ou computador (QR code). O QR code em alta resolução está em `docs/qr-app.png`.
- **APK para instalação direta:** `public/download/olivers-barbearia.apk` (pacote `br.com.oliversbarbearia.app`).
- **Verificação de domínio:** `public/.well-known/assetlinks.json`, que liga o app ao site.
- **iPhone:** instala como PWA (Safari → Compartilhar → Adicionar à Tela de Início).

A chave de assinatura (`signing.keystore`) **não fica no repositório**. Guarde-a com segurança: ela é necessária para publicar atualizações do app ou enviá-lo à Play Store no futuro (o arquivo `.aab` gerado junto já serve para isso).

## Publicação na Vercel

A Vercel não guarda arquivos entre requisições, então em produção o banco fica no **Turso** (SQLite na nuvem, plano grátis).

1. **Banco:** na Vercel, abra *Storage → Marketplace → Turso* e crie um banco. A integração já cria `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no projeto.
   Alternativa: crie em [turso.tech](https://turso.tech) e copie a URL e o token.
2. **Projeto:** em [vercel.com/new](https://vercel.com/new), importe este repositório do GitHub (Framework: *Other*; o `vercel.json` já configura tudo).
3. **Variáveis de ambiente** (*Settings → Environment Variables*):
   - `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` (se não vieram da integração)
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD` — conta do painel, criada no primeiro acesso
4. **Deploy.** As tabelas são criadas automaticamente na primeira requisição.
5. **Lembretes:** o `vercel.json` agenda `/api/cron/reminders` todo dia às 8h (horário de Brasília). Opcional: defina `CRON_SECRET` para proteger a rota.

Cada push na `main` gera um novo deploy; branches geram previews.
