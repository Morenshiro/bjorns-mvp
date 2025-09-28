import React, { useEffect, useMemo, useState } from "react";
import CFG from "./config";

/** ==== helpers ==== */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const fmt = (n) => Number(n || 0).toLocaleString("ru-RU");
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

/** ==== localStorage state hook ==== */
function useLocalState(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState];
}

/** ==== XP curve (твои якоря + 27% фолбэк) ==== */
function xpForLevel(lv) {
  const T = {
    1: 10, // 1→2
    2: 15, // 2→3
    3: 25, // 3→4
    4: 50, // 4→5
    5: 80, // 5→6
    12: 630, // 12→13
  };
  if (T[lv]) return T[lv];
  const prev = xpForLevel(lv - 1);
  const raw = Math.ceil(prev * 1.27); // рост 27%
  return Math.ceil(raw / 5) * 5; // округляем до 5
}

/** ==== Стоимость апа статов ==== */
// Якоря для Силы: цена апа при ТЕКУЩЕМ значении стата
const STRENGTH_ANCHORS = {
  5: 1,
  6: 6,
  7: 17,
  8: 37,
  9: 66,
  14: 398,
  325: 3287858, // 325→326 стоит 3,287,858
};

function expInterp(n, n1, v1, n2, v2) {
  // экспоненциальная интерполяция по логам между двумя якорями
  const a1 = Math.log(v1);
  const a2 = Math.log(v2);
  const t = (n - n1) / (n2 - n1);
  const val = Math.exp(a1 + (a2 - a1) * t);
  return val;
}

function strengthCostAt(n) {
  if (n <= 0) n = 1;
  const keys = Object.keys(STRENGTH_ANCHORS)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);

  if (STRENGTH_ANCHORS[n] != null) return STRENGTH_ANCHORS[n];

  const minK = keys[0];
  if (n < minK) {
    const x = n - minK;
    return Math.max(1, Math.round(4.5 * x * x - 2.5 * x + STRENGTH_ANCHORS[minK]));
  }

  // найдём соседа снизу и сверху
  let low = keys[0];
  let high = keys[keys.length - 1];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] <= n) low = keys[i];
    if (keys[i] >= n) { high = keys[i]; break; }
  }

  if (low === high) {
    // выше максимального якоря — экстраполяция по последним двум якорям (экспонента)
    const n1 = keys[keys.length - 2];
    const v1 = STRENGTH_ANCHORS[n1];
    const n2 = keys[keys.length - 1];
    const v2 = STRENGTH_ANCHORS[n2];
    const b = Math.log(v2 / v1) / (n2 - n1);
    const val = v2 * Math.exp(b * (n - n2));
    return Math.max(1, Math.round(val));
  }

  // между якорями — экспоненциальная интерполяция
  const vLow = STRENGTH_ANCHORS[low];
  const vHigh = STRENGTH_ANCHORS[high];
  const val = expInterp(n, low, vLow, high, vHigh);
  return Math.max(1, Math.round(val));
}

// Мультипликаторы для других статов (дороже → дешевле)
const STAT_MULT = {
  strength: 1.0, // Сила — эталон
  defense: 0.93,
  mastery: 0.90,
  agility: 0.86,
  vitality: 0.82,
};

function costForStat(statKey, currentValue) {
  const base = strengthCostAt(currentValue);
  const mult = STAT_MULT[statKey] ?? 1.0;
  return Math.max(1, Math.floor(base * mult));
}

/** ==== Компонент игры ==== */
export default function App() {
  /** === Состояние === */
  const [game, setGame] = useLocalState("bjorns-mvp-v01", {
    name: "Bjorns",

    // Балансы
    silver: 0,
    crystals: 0,
    gold: 0,

    // Прогресс (XP)
    progress: { level: 1, xp: 0, xpNext: xpForLevel(1) },

    // Заряды боёв
    fight: { max: 4, charges: 4, regenMinutes: 8, lastSpentAt: Date.now() },

    // Экспедиция
    expedition: { active: false, endsAt: 0, minutes: 0 },

    // Характеристики
    stats: { strength: 10, defense: 10, mastery: 10, agility: 10, vitality: 10 },

    // Дневные лимиты
    daily: { key: new Date().toISOString().slice(0, 10), crystals: 0, gold: 0 },

    // Бои учёт + лог
    battle: { wins: 0, losses: 0, streak: 0 },
    log: [],
  });

  // предпросмотр цели и экраны
  // preview: { kind, level?, stats, wallet?, name, bias? }
  const [preview, setPreview] = useState(null);
  // view: 'home' | 'arena' | 'wesps' | 'training'
  const [view, setView] = useState('home');
  // bias для поиска игроков: -1 ниже, 0 ровня, +1 выше
  const [playerBias, setPlayerBias] = useState(0);

  /** === Утилиты изменения баланса/лога === */
  const pushLog = (text) => setGame((g) => ({ ...g, log: [text, ...g.log].slice(0, 50) }));
  const addSilver = (x) => setGame((g) => ({ ...g, silver: g.silver + x }));
  const addCrystals = (x) => setGame((g) => ({ ...g, crystals: g.crystals + x }));
  const addGold = (x) => setGame((g) => ({ ...g, gold: g.gold + x }));
  const spendSilver = (x) => setGame((g) => ({ ...g, silver: Math.max(0, g.silver - x) }));

  /** === Level/XP === */
  const level = game.progress.level;
  useEffect(() => {
    setGame((g) => {
      const need = xpForLevel(g.progress.level);
      if (g.progress.xpNext !== need) return { ...g, progress: { ...g.progress, xpNext: need } };
      return g;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function addXP(amount) {
    if (amount <= 0) return;
    setGame((g) => {
      let { level, xp, xpNext } = g.progress;
      xp += amount;
      let leveled = false;
      while (xp >= xpNext) {
        xp -= xpNext;
        level += 1;
        xpNext = xpForLevel(level);
        leveled = true;
      }
      const next = { ...g, progress: { level, xp, xpNext } };
      return leveled ? { ...next, log: [`Уровень ${level}!`, ...g.log].slice(0, 50) } : next;
    });
  }

  /** === Боевой рейтинг (для шанса победы — не показываем) === */
  const powerScore = useMemo(() => {
    const s = game.stats;
    return Math.round(s.strength * 1.1 + s.defense * 1.0 + s.mastery * 1.15 + s.agility * 0.85 + s.vitality * 0.7);
  }, [game.stats]);

  /** === Реген зарядов боёв === */
  useEffect(() => {
    const id = setInterval(() => {
      setGame((g) => {
        const { charges, max, regenMinutes, lastSpentAt } = g.fight;
        if (charges >= max) return g;
        const intervalMs = regenMinutes * 60 * 1000;
        const passed = Math.floor((Date.now() - lastSpentAt) / intervalMs);
        if (passed <= 0) return g;
        const newCharges = clamp(charges + passed, 0, max);
        const newLast = lastSpentAt + passed * intervalMs;
        return { ...g, fight: { ...g.fight, charges: newCharges, lastSpentAt: newLast } };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [setGame]);

  /** === Сброс дневных лимитов === */
  useEffect(() => {
    const id = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      setGame((g) => (g.daily?.key !== today ? { ...g, daily: { key: today, crystals: 0, gold: 0 } } : g));
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  /** === Экспедиция тикер === */
  useEffect(() => {
    if (!game.expedition.active) return;
    const id = setInterval(() => { if (Date.now() >= game.expedition.endsAt) finishExpedition(); }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.expedition.active, game.expedition.endsAt]);

  /** === UI helpers === */
  const labelOf = (key) => ({ strength: "Сила", defense: "Защита", mastery: "Мастерство", agility: "Ловкость", vitality: "Живучесть" })[key] || key;
  const iconOf  = (key) => ({ strength: "🗡️", defense: "🛡️", mastery: "🌀", agility: "🦊", vitality: "❤️" })[key] || "";

  /** === Апы статов === */
  function upgradeStat(key) {
    const current = game.stats[key];
    const cost = costForStat(key, current);
    if (game.expedition.active) return;
    if (game.silver < cost) return;
    spendSilver(cost);
    setGame((g) => ({ ...g, stats: { ...g.stats, [key]: g.stats[key] + 1 } }));
    pushLog(`Ап ${labelOf(key)} за ${fmt(cost)} сера`);
  }

  /** === Бои === */
  function consumeFight() {
    setGame((g) => (g.fight.charges <= 0 ? g : { ...g, fight: { ...g.fight, charges: g.fight.charges - 1, lastSpentAt: Date.now() } }));
  }

  // Генерация игрока с bias (ниже/ровня/выше)
  function makePlayerTarget(bias = 0) {
    let min = level - 3, max = level + 3;
    if (bias < 0) { max = level - 1; }
    if (bias > 0) { min = level + 1; }
    if (min > max) { min = level - 3; max = level + 3; }
    const enemyLevel = clamp(rnd(min, max), 1, 999);
    const jitter = () => rnd(-3, 3);
    const base = 8 + enemyLevel * 2;
    const stats = {
      strength: clamp(base + jitter(), 5, 999),
      defense:  clamp(base + jitter(), 5, 999),
      mastery:  clamp(base + jitter(), 5, 999),
      agility:  clamp(base + jitter(), 5, 999),
      vitality: clamp(base + jitter(), 5, 999),
    };
    const wallet = { silver: rnd(600 * enemyLevel, 2000 * enemyLevel), crystals: rnd(0, Math.max(0, Math.floor(enemyLevel / 3))), gold: 0 };
    return { kind: "player", level: enemyLevel, stats, wallet, name: "Игрок", bias };
  }

  function scaleStats(baseStats, percent) {
    const s = { ...baseStats };
    for (const k of Object.keys(s)) s[k] = Math.max(5, Math.round(s[k] * (1 + percent / 100) + rnd(-2, 2)));
    return s;
  }

  function makeVesp(kind) {
    const my = game.stats; // от наших статов
    let stats = { ...my };
    let name = "Весп";
    if (kind === "vesp_silver") { stats = scaleStats(my, -15); name = "Весп (серебро)"; }
    if (kind === "vesp_crystal") { stats = scaleStats(my, rnd(-5, 5)); name = "Весп (кристалл)"; }
    if (kind === "vesp_gold")   { stats = scaleStats(my, +15); name = "Весп (золото)"; }
    return { kind, stats, wallet: { silver: rnd(800 * Math.max(1, level), 1600 * Math.max(1, level)) }, name };
  }

  // Предпросмотр и поиск
  function openPreview(kind) {
    if (game.expedition.active) return;
    if (kind === "player")       setPreview(makePlayerTarget(playerBias));
    if (kind === "vesp_silver")  setPreview(makeVesp("vesp_silver"));
    if (kind === "vesp_crystal") setPreview(makeVesp("vesp_crystal"));
    if (kind === "vesp_gold")    setPreview(makeVesp("vesp_gold"));
  }
  function nextPreview() {
    if (!preview) return;
    if (preview.kind === 'player') {
      setPreview(makePlayerTarget(preview.bias ?? playerBias));
    } else {
      openPreview(preview.kind);
    }
  }

  function winProbability(aStats, bStats) {
    const score = (s) => s.strength * 1.1 + s.defense * 1.0 + s.mastery * 1.15 + s.agility * 0.85 + s.vitality * 0.7;
    const A = score(aStats); const B = score(bStats);
    return clamp(Math.round((A / (A + B)) * 100), 5, 95);
  }

  function resolvePreviewFight() {
    if (!preview) return;
    if (game.expedition.active) return;
    if (game.fight.charges <= 0) { pushLog("Нет зарядов боя"); return; }
    if (preview.kind === "player") {
      if (Math.abs((preview.level || level) - level) > 3) { pushLog("Цель вне диапазона уровней"); return; }
    }

    consumeFight();

    const prob = winProbability(game.stats, preview.stats);
    const win = Math.random() * 100 < prob;

    // XP правила
    if (preview.kind === "player" && win) {
      const diff = (preview.level || level) - level;
      if (diff === 0) addXP(1);
      if (diff > 0) addXP(2);
    }

    // Награды
    if (preview.kind === "player") {
      if (win) {
        const stolenSilver = Math.floor((preview.wallet?.silver || 0) * 0.4);
        addSilver(stolenSilver);
        if (Math.random() < 0.1 && (preview.wallet?.crystals || 0) > 0) {
          const stolenCr = Math.max(1, Math.floor((preview.wallet?.crystals || 0) * 0.3));
          addCrystals(stolenCr);
          pushLog(`PvP: победа, +${fmt(stolenSilver)} сера, +${stolenCr} крист.`);
        } else {
          pushLog(`PvP: победа, +${fmt(stolenSilver)} сера`);
        }
      } else {
        pushLog("PvP: поражение");
      }
    } else {
      // VESP
      const baseSilver = preview.wallet?.silver || 0;
      if (preview.kind === "vesp_silver") {
        const s = baseSilver; // только серебро
        addSilver(s);
        pushLog(`Весп (серебро): +${fmt(s)} сера${win ? " (победа)" : " (поражение)"}`);
      }
      if (preview.kind === "vesp_crystal") {
        const s = Math.round(baseSilver * 1.2); // ×1.2
        addSilver(s);
        let extra = "";
        if (win && Math.random() < 0.5 && game.daily.crystals < 40) {
          const give = Math.min(5, 40 - game.daily.crystals);
          addCrystals(give);
          setGame((g) => ({ ...g, daily: { ...g.daily, crystals: g.daily.crystals + give } }));
          extra = `, +${give} крист.`;
        }
        pushLog(`Весп (кристалл): +${fmt(s)} сера${extra}${win ? " (победа)" : " (поражение)"}`);
      }
      if (preview.kind === "vesp_gold") {
        const s = Math.round(baseSilver * 1.5); // ×1.5
        addSilver(s);
        let extra = "";
        if (win && Math.random() < 0.30 && game.daily.gold < 15) {
          const give = Math.min(2, 15 - game.daily.gold);
          addGold(give);
          setGame((g) => ({ ...g, daily: { ...g.daily, gold: g.daily.gold + give } }));
          extra = `, +${give} зол.`;
        }
        pushLog(`Весп (золото): +${fmt(s)} сера${extra}${win ? " (победа)" : " (поражение)"}`);
      }
    }

    // статистика боёв
    setGame((g) => ({
      ...g,
      battle: {
        wins: g.battle.wins + (win ? 1 : 0),
        losses: g.battle.losses + (win ? 0 : 1),
        streak: win ? g.battle.streak + 1 : 0,
      },
    }));
  }

  /** === Экспедиции === */
  function startExpedition(minutes) {
    if (game.expedition.active) return;
    const endsAt = Date.now() + minutes * 60 * 1000;
    setGame((g) => ({ ...g, expedition: { active: true, endsAt, minutes } }));
    pushLog(`Начат поход на ${minutes} мин.`);
  }

  function finishExpedition() {
    if (!game.expedition.active) return;
    const minutes = game.expedition.minutes;
    const ticks = Math.max(1, Math.floor(minutes / 10));
    let s = 0, c = 0, gld = 0;
    for (let i = 0; i < ticks; i++) {
      const roll = Math.random();
      if (roll < 0.7) s += rnd(500 * Math.max(1, level), 1500 * Math.max(1, level));
      else if (roll < 0.95) c += rnd(1, Math.max(1, Math.floor(level / 2)));
      else gld += 1;
    }
    if (Math.random() < 0.07) addXP(1);
    if (s) addSilver(s);
    if (c) addCrystals(c);
    if (gld) addGold(gld);
    setGame((g) => ({ ...g, expedition: { active: false, endsAt: 0, minutes: 0 } }));
    pushLog(`Поход завершён: +${fmt(s)} сера${c ? ", +" + c + " крист." : ""}${gld ? ", +" + gld + " зол." : ""}`);
  }

  /** === UI === */
  const canFight = game.fight.charges > 0 && !game.expedition.active;
  const panel = { border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 16 };

  const StatRow = ({ k }) => {
    const cost = costForStat(k, game.stats[k]);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "4fr 4fr 4fr", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 14 }}>
        <div style={{ fontWeight: 600 }}>{iconOf(k)} {labelOf(k)}</div>
        <div className="tabular-nums">{game.stats[k]}</div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button disabled={game.silver < cost || game.expedition.active} onClick={() => upgradeStat(k)}>Ап ({fmt(cost)})</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(#0f172a, #1e293b)", color: "#e2e8f0", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Bjorns — браузерная RPG (MVP v0.1)</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: 'wrap' }}>
            {/* Навигация по режимам */}
            <button onClick={() => { setView('arena'); setPreview(null); }} title="Арена (игроки)">⚔️ Арена</button>
            <button onClick={() => { setView('wesps'); setPreview(null); }} title="Охота на веспов">👹 Веспы</button>
            <button onClick={() => { setView('training'); setPreview(null); }} title="Тренировка (ап статов)">🏋️ Тренировка</button>
            <button onClick={() => { setView('home'); setPreview(null); }} title="Главная">🏠 Дом</button>
            {/* Быстрые тест-кнопки */}
            <button onClick={() => addSilver(500000)}>💰 +500k</button>
            <button onClick={() => addCrystals(5)}>🔷 +5</button>
            <button onClick={() => addGold(1)}>🪙 +1</button>
            <button onClick={() => { if (window.confirm("Сбросить прогресс?")) { localStorage.removeItem("bjorns-mvp-v01"); window.location.reload(); } }}>♻️ Сброс</button>
          </div>
        </header>

        {/* Инфо-панель */}
        <section style={panel}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <div>💰 Сера: <b className="tabular-nums">{fmt(game.silver)}</b></div>
              <div>🔷 Кристаллы: <b className="tabular-nums">{fmt(game.crystals)}</b></div>
              <div>🪙 Золото: <b className="tabular-nums">{fmt(game.gold)}</b></div>
            </div>
            <div>
              <div>🎚️ Уровень: <b>{level}</b></div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 6 }}>
                  <div style={{ height: 8, width: `${clamp((game.progress.xp / game.progress.xpNext) * 100, 0, 100)}%`, background: "rgba(255,255,255,0.7)", borderRadius: 6 }} />
                </div>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{game.progress.xp}/{game.progress.xpNext} XP</span>
              </div>
              <div>⭐ Мощь: <b>{fmt(powerScore)}</b></div>
            </div>
            <div>
              <div>⚔️ Бои: <b>{game.fight.charges}</b>/<span>{game.fight.max}</span></div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>+1 бой каждые {game.fight.regenMinutes} мин</div>
            </div>
          </div>
        </section>

        {/* Контент по режимам */}
        {view === 'training' && (
          <section style={panel}>
            <h3 style={{ marginBottom: 8 }}>🏋️ Тренировка — ап статов</h3>
            {(["strength","defense","mastery","agility","vitality"]).map((k) => (
              <StatRow key={k} k={k} />
            ))}
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Стоимость апа растёт: Сила дороже всего → Живучесть дешевле всего.</div>
          </section>
        )}

        {view === 'arena' && (
          <section style={{ ...panel, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <h3 style={{ marginBottom: 8 }}>⚔️ Арена — поиск игроков</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button title="Игроки ниже уровня" onClick={() => { setPlayerBias(-1); setPreview(null); }}>⬇️ Ниже</button>
                <button title="Игроки твоего уровня" onClick={() => { setPlayerBias(0);  setPreview(null); }}>⏺️ Ровня</button>
                <button title="Игроки выше уровня" onClick={() => { setPlayerBias(1);  setPreview(null); }}>⬆️ Выше</button>
              </div>

              {!preview && (
                <button disabled={game.fight.charges<=0 || game.expedition.active} onClick={() => openPreview('player')}>🔎 Найти игрока</button>
              )}

              {preview && preview.kind==='player' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, opacity: 0.9 }}>
                    <div><b>Ты</b></div>
                    <div><b>{preview.name}</b> <span style={{ opacity: .7 }}>(лвл {preview.level})</span></div>
                  </div>
                  {["strength","defense","mastery","agility","vitality"].map(k => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
                      <div>{iconOf(k)} {labelOf(k)}: <b className="tabular-nums">{game.stats[k]}</b></div>
                      <div style={{ textAlign: 'right' }}>{iconOf(k)} <b className="tabular-nums">{preview.stats[k]}</b></div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={game.fight.charges<=0 || game.expedition.active} onClick={resolvePreviewFight}>Сражаться</button>
                    <button onClick={nextPreview}>Следующий</button>
                    <button style={{ marginLeft: 'auto' }} onClick={() => setPreview(null)}>Назад</button>
                  </div>
                </div>
              )}
            </div>

            <div/>
            <div/>
          </section>
        )}

        {view === 'wesps' && (
          <section style={{ ...panel, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <h3 style={{ marginBottom: 8 }}>👹 Веспы — выбрать тип</h3>
              {!preview && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <button disabled={game.fight.charges<=0 || game.expedition.active} onClick={() => openPreview('vesp_silver')}>🥈 Серебряный</button>
                  <button disabled={game.fight.charges<=0 || game.expedition.active} onClick={() => openPreview('vesp_crystal')}>💠 Кристальный</button>
                  <button disabled={game.fight.charges<=0 || game.expedition.active} onClick={() => openPreview('vesp_gold')}>🥇 Золотой</button>
                </div>
              )}

              {preview && preview.kind!=='player' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, opacity: 0.9 }}>
                    <div><b>Ты</b></div>
                    <div><b>{preview.name}</b></div>
                  </div>
                  {["strength","defense","mastery","agility","vitality"].map(k => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
                      <div>{iconOf(k)} {labelOf(k)}: <b className="tabular-nums">{game.stats[k]}</b></div>
                      <div style={{ textAlign: 'right' }}>{iconOf(k)} <b className="tabular-nums">{preview.stats[k]}</b></div>
                    </div>
                  ))}

                  {/* Грубая оценка награды */}
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {preview.kind === "vesp_silver"  && `Награда: серебро (≈${fmt(rnd(800 * Math.max(1, level), 1600 * Math.max(1, level)))}).`}
                    {preview.kind === "vesp_crystal" && `Награда: серебро (≈${fmt(Math.round(1.2 * rnd(800 * Math.max(1, level), 1600 * Math.max(1, level))))}), 50% шанс на +5 крист. (лимит 40/день).`}
                    {preview.kind === "vesp_gold"    && `Награда: серебро (≈${fmt(Math.round(1.5 * rnd(800 * Math.max(1, level), 1600 * Math.max(1, level))))}), 30% шанс на +2 зол. (лимит 15/день).`}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={game.fight.charges<=0 || game.expedition.active} onClick={resolvePreviewFight}>Сражаться</button>
                    <button onClick={nextPreview}>Следующий</button>
                    <button style={{ marginLeft: 'auto' }} onClick={() => setPreview(null)}>Назад</button>
                  </div>
                </div>
              )}
            </div>

            <div/>
            <div/>
          </section>
        )}

        {/* Домашний вид */}
        {view === 'home' && (
          <section style={{ ...panel, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <h3 style={{ marginBottom: 8 }}>Быстрый доступ</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <button onClick={() => { setView('arena'); setPreview(null); }}>⚔️ Перейти к арене</button>
                <button onClick={() => { setView('wesps'); setPreview(null); }}>👹 Перейти к веспам</button>
                <button onClick={() => { setView('training'); setPreview(null); }}>🏋️ Перейти к тренировке</button>
              </div>
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>Походы</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                {[10, 20, 60, 240, 360].map((m) => (
                  <button key={m} disabled={game.expedition.active} onClick={() => startExpedition(m)}>{m} мин</button>
                ))}
              </div>
              {game.expedition.active ? (
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  Идёт поход на {game.expedition.minutes} мин. Завершение: {new Date(game.expedition.endsAt).toLocaleTimeString()}
                  <div style={{ marginTop: 8 }}><button onClick={finishExpedition}>Завершить (если время вышло)</button></div>
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>Во время похода сражаться нельзя. Дроп: часто сера, реже кристаллы, очень редко золото. 7% шанс получить 1 XP.</div>
              )}
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>Журнал</h3>
              <div style={{ height: 160, overflow: "auto", fontSize: 14, paddingRight: 6, display: "grid", gap: 4 }}>
                {game.log.length === 0 && <div style={{ opacity: 0.6 }}>Пусто…</div>}
                {game.log.map((line, i) => (<div key={i} style={{ opacity: 0.9 }}>• {line}</div>))}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Победы: {game.battle.wins} / Поражения: {game.battle.losses} / Стрик: {game.battle.streak}</div>
            </div>
          </section>
        )}

        <footer style={{ fontSize: 12, opacity: 0.6, textAlign: "center" }}>
          MVP v0.1 — XP-система, предпросмотр целей, сравнение статов, арена-фильтры, веспы (серебро/кристалл/золото), дневные лимиты, походы. Дальше: экспорт сейва, конфиг экономики, питомец, бусты.
        </footer>
      </div>
    </div>
  );
}
