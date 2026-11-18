// Regra de preço compartilhada pelo app (prévia) e pelo servidor (valor oficial).
// Se a seleção contém todos os serviços de um combo, troca pelo combo (mais barato).
//
// services: [{ id, name, price, duration, includes?: string[], active }]
// selected: ids escolhidos pelo cliente
export function resolveSelection(selected, services) {
  const byId = new Map(services.filter((s) => s.active !== false).map((s) => [s.id, s]));
  const picked = [...new Set(selected)].filter((id) => byId.has(id));
  const remaining = new Set(picked);

  // Combos válidos, do que inclui mais serviços para o que inclui menos (e maior economia primeiro).
  const combos = [...byId.values()]
    .filter((s) => Array.isArray(s.includes) && s.includes.length > 1 && s.includes.every((id) => byId.has(id)))
    .map((c) => ({ c, saving: c.includes.reduce((t, id) => t + byId.get(id).price, 0) - c.price }))
    .filter((x) => x.saving >= 0)
    .sort((a, b) => b.c.includes.length - a.c.includes.length || b.saving - a.saving);

  const applied = [];
  for (const { c } of combos) {
    if (remaining.has(c.id)) continue;
    if (c.includes.every((id) => remaining.has(id))) {
      c.includes.forEach((id) => remaining.delete(id));
      applied.push(c);
    }
  }

  const items = [...applied, ...picked.filter((id) => remaining.has(id)).map((id) => byId.get(id))];
  const price = items.reduce((t, s) => t + s.price, 0);
  const duration = items.reduce((t, s) => t + s.duration, 0);
  const original = picked.reduce((t, id) => t + byId.get(id).price, 0);
  return {
    items: items.map(({ id, name, price: p, duration: d }) => ({ id, name, price: p, duration: d })),
    price,
    duration,
    original,
    savings: Math.max(0, original - price),
    combos: applied.map((c) => c.name),
    label: items.map((s) => s.name).join(' + '),
  };
}
