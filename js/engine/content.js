// Завантаження контенту пригоди: маніфест, карта, блоки сцен, загальні файли, скіл Ведучого.

export async function loadAdventure(base) {
  const getText = async (path) => {
    const res = await fetch(`${base}/${path}`);
    if (!res.ok) throw new Error(`Не вдалося завантажити ${path}`);
    return res.text();
  };
  const manifest = JSON.parse(await getText("manifest.json"));
  const files = new Set([
    ...manifest.context.always,
    ...manifest.context.boss,
    manifest.context.inserts,
    ...Object.values(manifest.blocks).map((b) => b.file),
  ]);
  const texts = {};
  await Promise.all([...files].map(async (f) => { texts[f] = await getText(f); }));
  return { manifest, texts };
}

export async function loadSkill(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("Не вдалося завантажити скіл Ведучого");
  return res.text();
}
