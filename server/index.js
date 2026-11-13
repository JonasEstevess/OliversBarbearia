import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

// Importa depois de carregar o .env, pois o banco lê as variáveis ao iniciar.
const { app } = await import('./app.js');

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Oliver's Barbearia rodando em http://localhost:${port}`));
