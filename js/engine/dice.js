// Розрахунок кидка на клієнті (D-46): бонуси, ліміт, успіх, критичність. Ведучий отримує готовий результат.

export function rollDie() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 6) + 1;
}

// hero: ID героя або "both"; roll: { kind, tags, idea, plan_step } від Ведучого; value: число на кубику.
// Змінює state: Іскра, заготовки, лічильник плану.
export function resolveRoll(manifest, state, hero, roll, value) {
  const rules = manifest.rules;
  const kind = roll?.kind ?? "action";
  const tags = new Set(roll?.tags ?? []);
  const applied = [];
  if (hero === "both") applied.push(["Дружнє плече", rules.friendly_shoulder]);
  if (roll?.idea) applied.push(["Вдала ідея", rules.idea]);
  if (state.spark_pending) { applied.push(["Іскра", rules.spark]); state.spark_pending = false; }

  let fullPlan = false;
  const step = roll?.plan_step ?? 0;
  if (step === 1) state.plan = { ok: 0, broken: false };
  if (step >= 2 && state.plan && !state.plan.broken) {
    const bonus = 1 + (state.plan.ok >= 2 ? 1 : 0);
    fullPlan = bonus === 2;
    applied.push(["План", bonus]);
  }

  if (kind === "action" || rules.prepared_in_defense) {
    const groups = new Set();
    const memories = state.inventory.filter((id) => manifest.items[id]?.memory).length;
    for (const b of manifest.bonuses) {
      if (b.uses !== null && !state.prepared.includes(b.id)) continue;
      if (!(b.tags_all ?? []).every((t) => tags.has(t))) continue;
      if (b.tags_any && !b.tags_any.some((t) => tags.has(t))) continue;
      if (b.requires_item && !state.inventory.includes(b.requires_item)) continue;
      if (b.requires_memories && memories < b.requires_memories) continue;
      if (b.exclusive_group) {
        if (groups.has(b.exclusive_group)) continue;
        groups.add(b.exclusive_group);
      }
      applied.push([b.name, b.value]);
      if (b.uses === 1) state.prepared = state.prepared.filter((p) => p !== b.id);
    }
  }

  const cap = fullPlan ? rules.bonus_cap_full_plan : rules.bonus_cap;
  const bonus = Math.min(cap, applied.reduce((s, [, v]) => s + v, 0));
  const total = value + bonus;
  let success = total >= rules.target && value !== 1;
  let critical = value === 6 ? "spark" : value === 1 ? "funny_fail" : "none";
  if (value === 1 && fullPlan && total >= rules.target) { success = true; critical = "partial"; }
  if (value === 6 && (hero !== "both" || rules.spark_on_joint_roll)) state.spark_pending = true;
  if (step >= 1 && state.plan) {
    if (success) state.plan.ok += 1; else state.plan.broken = true;
  }
  return { hero, value, bonuses: applied.map(([n]) => n), total, success, critical };
}

// Картинка критичного кидка з Бібліотеки, не повторюючи останню показану (D-21).
export function criticalImage(manifest, result, lastShown) {
  const pics = manifest.client_images;
  let pool = [];
  if (result.critical === "spark") pool = result.hero === "both" ? pics.critical_success_joint : pics.critical_success;
  if (result.critical === "funny_fail") pool = result.hero === "both" ? pics.critical_fail_joint : pics.critical_fail[result.hero];
  pool = (pool ?? []).filter((id) => id !== lastShown);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
