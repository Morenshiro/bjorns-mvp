// Centralized economy & balance config for Bjorns MVP
// Правь числа тут — игра подхватит без правки логики.

const CFG = {
  xp: {
    anchors: { 1: 10, 2: 15, 3: 25, 4: 50, 5: 80, 12: 630 },
    growth: 1.27,       // рост, если нет якоря (27%)
    roundTo: 5          // округление требований XP до кратных 5
  },
  stats: {
    // Цена апа Силы: якоря "текущий -> следующий"
    strengthAnchors: {
      5: 1,
      6: 6,
      7: 17,
      8: 37,
      9: 66,
      14: 398,
      325: 3287858
    },
    // Мультипликаторы стоимости для остальных статов
    multipliers: {
      strength: 1.0,  // эталон
      defense: 0.93,
      mastery: 0.90,
      agility: 0.86,
      vitality: 0.82
    }
  },
  fights: {
    max: 4,            // максимум зарядов боя
    regenMinutes: 8    // реген 1 заряда
  },
  players: {
    searchLevelRange: 3, // поиск соперников в диапазоне ±N уровней
    statBaseA: 8,        // базовые статы противника = A + level * B
    statBaseB: 2,
    statJitter: 3        // разброс по каждому стату ±J
  },
  pvp: {
    levelRange: 3,          // бить можно в пределах ±N уровней
    stealSilver: 0.40,      // сколько серебра воруется с победы
    crystalStealChance: 0.10,
    crystalStealPercent: 0.30,
    xpSame: 1,              // XP за победу по ровне
    xpHigher: 2             // XP за победу по выше уровню
  },
  wesps: {
    baseSilverPerFightPerLevel: { min: 800, max: 1600 },
    silver: {
      statScalePercent: -15,    // статы слабее наших
      silverMult: 1.0
    },
    crystal: {
      statScalePercentMin: -5,  // статы колеблются вокруг наших
      statScalePercentMax: 5,
      silverMult: 1.2,
      crystalChance: 0.5,       // шанс на кристаллы при победе
      crystalPerWin: 5,
      dailyCrystalCap: 40
    },
    gold: {
      statScalePercent: 15,     // статы сильнее наших
      silverMult: 1.5,
      goldChance: 0.30,
      goldPerWin: 2,
      dailyGoldCap: 15
    }
  },
  expedition: {
    tickMinutes: 10,              // один тик дропа на каждые N минут
    silverChance: 0.70,
    crystalChance: 0.25,          // остаток идёт в золото (0.05)
    silverPerTickPerLevel: { min: 500, max: 1500 },
    crystalMaxPerLevelDiv: 2,     // макс кристаллов за тик = floor(level / div)
    xpChance: 0.07
  }
};

export default CFG;
