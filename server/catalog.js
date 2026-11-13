// Dados da Oliver's Barbearia.

export const shop = {
  name: "Oliver's Barbearia",
  since: 2014,
  tagline: 'Especialista em Afro',
  address: 'R. Serra dos Dois Irmãos, 474 — Jardim Amália, São Paulo/SP',
  cep: '05890-300',
  phone: '(11) 95121-7241',
  whatsapp: '5511951217241',
  instagram: 'oliversbarbearia01',
  mapsUrl: 'https://maps.app.goo.gl/?q=Oliver%27s+Barbearia+R.+Serra+dos+Dois+Irm%C3%A3os+474',
  rating: 4.8,
  reviews: 21, // avaliações no Google
  timezone: 'America/Sao_Paulo',
};

// Expediente por dia da semana (0 = domingo). Intervalos em "HH:MM".
export const openingHours = {
  0: [['09:00', '14:00']],
  1: [],
  2: [['09:00', '14:00'], ['15:00', '20:00']],
  3: [['09:00', '14:00'], ['15:00', '20:00']],
  4: [['09:00', '14:00'], ['15:00', '20:00']],
  5: [['09:00', '14:00'], ['15:00', '20:00']],
  6: [['09:00', '14:00'], ['15:00', '20:00']],
};

// photo: caminho em public/img (ex.: '/img/equipe/tayson.jpg'). Sem foto, mostra as iniciais.
export const barbers = [
  { id: 'tayson', name: 'Tayson Silva', role: 'Barbeiro', specialty: 'Barbeiro', photo: null },
  { id: 'luiz', name: 'Luiz', role: 'Barbeiro', specialty: 'Barbeiro', photo: null },
];

export const categories = [
  { id: 'cabelo', name: 'Cabelo' },
  { id: 'barba', name: 'Barba' },
  { id: 'combos', name: 'Combos' },
  { id: 'quimica', name: 'Química' },
  { id: 'extras', name: 'Extras' },
];

// price em centavos, duration em minutos
export const services = [
  { id: 'corte', cat: 'cabelo', name: 'Corte comum', desc: 'Corte realizado na máquina.', price: 4000, duration: 30, popular: true },
  { id: 'corte-tesoura', cat: 'cabelo', name: 'Corte na tesoura', desc: 'Corte realizado somente com tesoura.', price: 5000, duration: 40 },
  { id: 'pezinho', cat: 'cabelo', name: 'Pezinho', desc: 'Acabamento do contorno.', price: 1500, duration: 10 },
  { id: 'hidratacao', cat: 'cabelo', name: 'Hidratação', desc: 'Lavagem, máscara potente e finalização com condicionador.', price: 2000, duration: 15 },

  { id: 'barba', cat: 'barba', name: 'Barba', desc: 'Barba feita com shaving e navalha.', price: 2500, duration: 20 },
  { id: 'barba-toalha', cat: 'barba', name: 'Barba na toalha quente', desc: 'Barba feita com toalha quente.', price: 3500, duration: 35 },
  { id: 'barba-pigmentacao', cat: 'barba', name: 'Barba com pigmentação', desc: 'Barba com pigmentação dos fios, realçando os pelos.', price: 4000, duration: 40 },

  { id: 'corte-barba', cat: 'combos', name: 'Corte + barba', desc: 'Corte na máquina e barba com shaving e navalha.', price: 6500, duration: 45, popular: true },
  { id: 'corte-sobrancelha', cat: 'combos', name: 'Corte + sobrancelha', desc: 'Corte na máquina e sobrancelha na navalha.', price: 4500, duration: 35, popular: true },
  { id: 'corte-barba-sobrancelha', cat: 'combos', name: 'Corte + barba + sobrancelha', desc: 'O combo completo.', price: 7000, duration: 50 },
  { id: 'corte-barba-toalha', cat: 'combos', name: 'Corte + barba na toalha', desc: 'Corte na máquina e barba com toalha quente.', price: 7500, duration: 50 },
  { id: 'combo-premium', cat: 'combos', name: 'Corte + barba toalha + sobrancelha', desc: 'Experiência completa com toalha quente.', price: 8000, duration: 75 },

  { id: 'progressiva', cat: 'quimica', name: 'Progressiva', desc: 'Alisamento definitivo de qualquer estrutura de cabelo.', price: 6500, duration: 30 },
  { id: 'botox', cat: 'quimica', name: 'Botox', desc: 'Alisa e trata, repondo massa e rejuvenescendo os fios.', price: 5000, duration: 30 },
  { id: 'relaxamento', cat: 'quimica', name: 'Relaxamento', desc: 'Diminui volume e frizz.', price: 3000, duration: 10 },
  { id: 'pigmentacao', cat: 'quimica', name: 'Pigmentação na barba', desc: 'Pigmentação dos fios da barba.', price: 2000, duration: 40 },

  { id: 'sobrancelha', cat: 'extras', name: 'Sobrancelha', desc: 'Sobrancelha feita na navalha.', price: 1500, duration: 10 },
];

export const SLOT_STEP_MIN = 15;
export const BOOKING_WINDOW_DAYS = 30;
export const CANCEL_MIN_HOURS = 2;
