
"use strict";

const api = sandkit.api;
const FH = sandkit.engine.api;
const state = sandkit.state;

const MOD_ID = "tex.resource-silo";
const STRUCTURE_ID = "texResourceSilo";
const ICON16_ID = "texResourceSiloIcon16";

const FOOTPRINT = 20;

const PROCESS_INTERVAL_MS = 50;

const GAS_MATTER_TYPE = 4;

const GAS_STRUCTURE_ID = "texGasSilo";
const GAS_ICON16_ID = "texGasSiloIcon16";



const SILO_COIN_BANK_KEY = "siloCoinBanked";
const SILO_COIN_REMAINDER_KEY = "siloCoinRemainder";

function currencyValueFromName(name) {
  const normalized = String(
    name || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "gold") {
    return 1;
  }

  if (
    normalized === "liquid gold" ||
    normalized === "liquidgold"
  ) {
    return 2;
  }

  if (
    normalized === "gold granulate" ||
    normalized === "goldgranulate"
  ) {
    return 4;
  }

  return 0;
}

function currencyValueForStructure(structure) {
  if (!structure) {
    return 0;
  }

  structure.data ||= {};

  const saved =
    Number(
      structure.data.siloCurrencyValue
    );

  if (
    saved === 1 ||
    saved === 2 ||
    saved === 4
  ) {
    return saved;
  }

  const value =
    currencyValueFromName(
      structure.data.siloTypeName
    );

  if (value > 0) {
    structure.data.siloCurrencyValue =
      value;
  }

  return value;
}



const SILO_LAST_INJECTED_KEY = "siloLastInjectedCoins";

function getLastInjectedSiloCoins() {
  const value =
    Number(
      api.storage.get(
        MOD_ID,
        SILO_LAST_INJECTED_KEY
      )
    );

  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function setLastInjectedSiloCoins(value) {
  api.storage.set(
    MOD_ID,
    SILO_LAST_INJECTED_KEY,
    Math.max(
      0,
      Math.floor(Number(value) || 0)
    )
  );
}

function emitNativeGoldChanged(total) {
  try {
    state.store.resources.gold = total;
  } catch (_) {}

  try {
    FH.events.emit(
      state,
      "resources:goldChanged",
      { gold: total }
    );
  } catch (_) {}

  try {
    FH.ui.overlays.update(
      state,
      "resources"
    );
  } catch (_) {}
}

function syncSilosIntoNativeGold() {
  if (
    !state?.shared?.gold
  ) {
    return null;
  }

  const siloCoins =
    Math.max(
      0,
      Math.floor(
        calculatePhysicalSiloCoinValue() || 0
      )
    ) +
    getCoinRemainder();

  let current = 0;

  try {
    current =
      Number(
        Atomics.load(
          state.shared.gold,
          0
        )
      ) || 0;
  } catch (_) {
    return null;
  }

  
  const previousInjected =
    getLastInjectedSiloCoins();

  let nativeCollectorGold;

  if (
    current >=
    previousInjected
  ) {
    nativeCollectorGold =
      current -
      previousInjected;
  } else {
    nativeCollectorGold =
      current;
  }

  nativeCollectorGold =
    Math.max(
      0,
      Math.floor(
        nativeCollectorGold
      )
    );

  const combined =
    nativeCollectorGold +
    siloCoins;

  try {
    Atomics.store(
      state.shared.gold,
      0,
      combined
    );
  } catch (_) {
    return null;
  }

  setLastInjectedSiloCoins(
    siloCoins
  );

  setSiloBankedCoins(
    siloCoins
  );

  emitNativeGoldChanged(
    combined
  );

  return {
    nativeCollectorGold,
    siloCoins,
    combined
  };
}

function getCoinRemainder() {
  const value = Number(
    api.storage.get(
      MOD_ID,
      SILO_COIN_REMAINDER_KEY
    )
  );

  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function setCoinRemainder(value) {
  api.storage.set(
    MOD_ID,
    SILO_COIN_REMAINDER_KEY,
    Math.max(
      0,
      Math.floor(Number(value) || 0)
    )
  );
}

function getSiloBankedCoins() {
  const value = Number(
    api.storage.get(
      MOD_ID,
      SILO_COIN_BANK_KEY
    )
  );

  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function setSiloBankedCoins(value) {
  const amount = Math.max(
    0,
    Math.floor(Number(value) || 0)
  );

  api.storage.set(
    MOD_ID,
    SILO_COIN_BANK_KEY,
    amount
  );

  return amount;
}

function adjustSiloBankedCoins(delta) {
  return setSiloBankedCoins(
    getSiloBankedCoins() +
    Math.trunc(Number(delta) || 0)
  );
}

function calculatePhysicalSiloCoinValue() {
  let total = 0;

  try {
    api.structures.forEachOfType(
      STRUCTURE_ID,
      structure => {
        const value =
          currencyValueForStructure(
            structure
          );

        if (value <= 0) {
          return;
        }

        total +=
          Math.floor(
            storedCount(structure)
          ) * value;
      }
    );
  } catch (err) {
    console.warn(
      `[${MOD_ID}] Failed to total silo currency:`,
      err
    );
    return null;
  }

  return total;
}

function reconcileSiloCurrency() {
  const physical =
    calculatePhysicalSiloCoinValue();

  if (physical === null) {
    return null;
  }

  const expected =
    physical +
    getCoinRemainder();

  if (
    expected !==
    getSiloBankedCoins()
  ) {
    setSiloBankedCoins(expected);
  }

  const nativeSync =
    syncSilosIntoNativeGold();

  return nativeSync
    ? nativeSync.combined
    : expected;
}

function spendSiloCoins(amount) {
  let remaining = Math.max(
    0,
    Math.floor(Number(amount) || 0)
  );

  if (remaining <= 0) {
    return 0;
  }

  const requested = remaining;

  const credit = getCoinRemainder();

  if (credit > 0) {
    const use =
      Math.min(
        credit,
        remaining
      );

    setCoinRemainder(
      credit - use
    );

    remaining -= use;
  }

  try {
    api.structures.forEachOfType(
      STRUCTURE_ID,
      structure => {
        if (remaining <= 0) return;

        if (
          currencyValueForStructure(
            structure
          ) !== 1
        ) {
          return;
        }

        const available =
          Math.floor(
            storedCount(structure)
          );

        const take =
          Math.min(
            available,
            remaining
          );

        if (
          take > 0 &&
          removeFromBuffer(
            structure,
            take,
            true
          )
        ) {
          remaining -= take;
        }
      }
    );
  } catch (err) {
    console.error(
      `[${MOD_ID}] Failed spending Gold silo currency:`,
      err
    );
  }

  try {
    api.structures.forEachOfType(
      STRUCTURE_ID,
      structure => {
        if (remaining <= 0) return;

        if (
          currencyValueForStructure(
            structure
          ) !== 2
        ) {
          return;
        }

        const available =
          Math.floor(
            storedCount(structure)
          );

        if (available <= 0) {
          return;
        }

        const particlesNeeded =
          Math.min(
            available,
            Math.ceil(
              remaining / 2
            )
          );

        if (
          particlesNeeded > 0 &&
          removeFromBuffer(
            structure,
            particlesNeeded,
            true
          )
        ) {
          const coinValue =
            particlesNeeded * 2;

          if (
            coinValue >
            remaining
          ) {
            setCoinRemainder(
              getCoinRemainder() +
              (
                coinValue -
                remaining
              )
            );
          }

          remaining =
            Math.max(
              0,
              remaining -
              coinValue
            );
        }
      }
    );
  } catch (err) {
    console.error(
      `[${MOD_ID}] Failed spending Liquid Gold silo currency:`,
      err
    );
  }

  try {
    api.structures.forEachOfType(
      STRUCTURE_ID,
      structure => {
        if (remaining <= 0) return;

        if (
          currencyValueForStructure(
            structure
          ) !== 4
        ) {
          return;
        }

        const available =
          Math.floor(
            storedCount(structure)
          );

        if (available <= 0) {
          return;
        }

        const particlesNeeded =
          Math.min(
            available,
            Math.ceil(
              remaining / 4
            )
          );

        if (
          particlesNeeded > 0 &&
          removeFromBuffer(
            structure,
            particlesNeeded,
            true
          )
        ) {
          const coinValue =
            particlesNeeded * 4;

          if (
            coinValue >
            remaining
          ) {
            setCoinRemainder(
              getCoinRemainder() +
              (
                coinValue -
                remaining
              )
            );
          }

          remaining =
            Math.max(
              0,
              remaining -
              coinValue
            );
        }
      }
    );
  } catch (err) {
    console.error(
      `[${MOD_ID}] Failed spending Gold Granulate silo currency:`,
      err
    );
  }

  const spent =
    requested - remaining;

  if (spent > 0) {
    adjustSiloBankedCoins(
      -spent
    );
  }

  return spent;
}



api.hooks.modify(
  "gold:removal:prepare",
  args => {
    const shortfall =
      Number(args.shortfall);

    if (
      !Number.isFinite(shortfall) ||
      shortfall <= 0
    ) {
      return;
    }

    const physical =
      calculatePhysicalSiloCoinValue();

    if (physical === null) {
      return;
    }

    const available =
      Math.max(
        0,
        Math.floor(physical) +
          getCoinRemainder()
      );

    args.shortfall =
      Math.max(
        0,
        shortfall - available
      );
  }
);

api.hooks.modify(
  "gold:removal:settle",
  args => {
    const shortfall =
      Number(args.shortfall);

    if (
      !Number.isFinite(shortfall) ||
      shortfall <= 0
    ) {
      return;
    }

    const spent =
      spendSiloCoins(
        shortfall
      );

    args.shortfall =
      Math.max(
        0,
        shortfall - spent
      );

    if (spent > 0) {
      syncSilosIntoNativeGold();
    }
  }
);


function elementDefinition(t) {
  try {
    return api.elements.getDefinitionByType(t);
  } catch (_) {
    return null;
  }
}

function fitFontSize(ctx, text, maxWidth, maxPx, minPx, fontSpec) {
  let size = maxPx;
  while (size > minPx) {
    ctx.font = fontSpec(size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  ctx.font = fontSpec(size);
  return size;
}

function displayNameForType(t) {
  try {
    const engineState = sandkit.engine && sandkit.engine.state
      ? sandkit.engine.state
      : null;
    if (engineState) {
      const name = sandkit.engine.api.elements.getName(engineState, Number(t));
      if (name && typeof name === "string") return name;
    }
  } catch (_) {}

  try {
    const d = elementDefinition(Number(t));
    const raw = (d && (d.displayNameOverride || d.displayName || d.name || d.id));
    if (raw && typeof raw === "string") {
      return raw
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch (_) {}

  return `Element ${t}`;
}

function isStorable(t) {
  const d = elementDefinition(t);
  if (!d) return false;
  if (d.matterType === 0) return false;
  if (d.isTransportable === false && d.matterType !== GAS_MATTER_TYPE) {
    return false;
  }
  return true;
}

function inputCells(structure) {
  const cells = [];
  const y = structure.y - 1;
  for (let i = 0; i < FOOTPRINT; i++) {
    cells.push({ x: structure.x + i, y });
  }
  return cells;
}

function outputCells(structure) {
  const cells = [];
  const y = structure.y + FOOTPRINT;
  for (let i = 0; i < FOOTPRINT; i++) {
    cells.push({ x: structure.x + i, y });
  }
  return cells;
}

function lockedType(structure) {
  const t = structure.data && structure.data.siloType;
  return t === null || t === undefined ? null : Number(t);
}

function storedCount(structure) {
  return Math.max(0, Number(structure.data && structure.data.siloCount) || 0);
}

function addToBuffer(
  structure,
  t,
  amount
) {
  structure.data ||= {};
  structure.data.siloType = t;
  structure.data.siloTypeName =
    displayNameForType(t);
  structure.data.siloCount =
    storedCount(structure) + amount;

  const currencyValue =
    currencyValueFromName(
      structure.data.siloTypeName
    );

  if (currencyValue > 0) {
    structure.data.siloCurrencyValue =
      currencyValue;

    adjustSiloBankedCoins(
      amount * currencyValue
    );

    syncSilosIntoNativeGold();
  }
}

function removeFromBuffer(
  structure,
  amount,
  skipCurrencyLedger = false
) {
  const currencyValue =
    currencyValueForStructure(
      structure
    );

  const current =
    storedCount(structure);

  if (current < amount) {
    return false;
  }

  const next =
    current - amount;

  structure.data.siloCount = next;

  if (next <= 0) {
    structure.data.siloCount = 0;
    structure.data.siloType = null;
    structure.data.siloTypeName = "Empty";
    structure.data.siloCurrencyValue = 0;
  }

  if (
    !skipCurrencyLedger &&
    currencyValue > 0
  ) {
    adjustSiloBankedCoins(
      -(amount * currencyValue)
    );

    syncSilosIntoNativeGold();
  }

  return true;
}


function tryConsumeAt(processor, x, y, elementType) {
  let removed = false;

  try {
    removed = processor.commit([
      {
        kind: "remove",
        cellX: x,
        cellY: y,
        expectedElementType: elementType,
      },
    ]);
  } catch (_) {
    removed = false;
  }

  if (!removed) {
    try {
      api.elements.removeAtCellWhenIdle(x, y);
      removed = true;
    } catch (_) {}
  }

  return removed;
}

function captureInputs(structure, processor) {
  for (const cell of inputCells(structure)) {
    let t = null;

    try {
      t = processor.getElementTypeAtCell(cell.x, cell.y);
    } catch (_) {
      continue;
    }

    if (t === null || t === undefined) continue;
    if (!isStorable(t)) continue;

    const locked = lockedType(structure);
    if (locked !== null && locked !== t) continue;

    if (tryConsumeAt(processor, cell.x, cell.y, t)) {
      addToBuffer(structure, t, 1);
      structure.data.siloLastIntakeAt = Date.now();
      try {
        api.world.reportActivityAtCell(cell.x, cell.y);
      } catch (_) {}
    }
  }
}


const INTERIOR_SWEEP_BUDGET_PER_TICK = 64;
const interiorSweepCursor = new Map();

function posKey(x, y) {
  return `${x},${y}`;
}


function sweepInterior(structure, processor) {
  const key = posKey(structure.x, structure.y);
  let cursor = interiorSweepCursor.get(key) || 0;

  const total = FOOTPRINT * FOOTPRINT;
  const locked = lockedType(structure);

  for (let n = 0; n < INTERIOR_SWEEP_BUDGET_PER_TICK; n++) {
    const idx = (cursor + n) % total;
    const dx = idx % FOOTPRINT;
    const dy = Math.floor(idx / FOOTPRINT);
    const x = structure.x + dx;
    const y = structure.y + dy;

    let t = null;
    try {
      t = processor.getElementTypeAtCell(x, y);
    } catch (_) {
      continue;
    }

    if (t === null || t === undefined) continue;


    if (isStorable(t) && (locked === null || locked === t)) {
      if (tryConsumeAt(processor, x, y, t)) {
        addToBuffer(structure, t, 1);
        try {
          api.world.reportActivityAtCell(x, y);
        } catch (_) {}
      }
    } else {
      continue;
    }
  }

  interiorSweepCursor.set(key, (cursor + INTERIOR_SWEEP_BUDGET_PER_TICK) % total);
}

function dispenseOutputs(structure, processor) {
  const t = lockedType(structure);
  if (t === null || storedCount(structure) <= 0) return;

  for (const cell of outputCells(structure)) {
    if (storedCount(structure) <= 0) break;

    let occupied = true;

    try {
      occupied = processor.getElementTypeAtCell(cell.x, cell.y) !== null;
    } catch (_) {
      occupied = true;
    }

    if (occupied) continue;

    let created = false;
    try {
      created = processor.commit([
        {
          kind: "create",
          cellX: cell.x,
          cellY: cell.y,
          elementType: t,
        },
      ]);
    } catch (_) {
      created = false;
    }

    if (created) {
      removeFromBuffer(structure, 1);
      structure.data.siloLastOutputAt = Date.now();
      try {
        api.world.reportActivityAtCell(cell.x, cell.y);
      } catch (_) {}
    }
  }
}

function processSilo(structure, processor) {
  if (!structure) return;


  dispenseOutputs(structure, processor);
  captureInputs(structure, processor);
  sweepInterior(structure, processor);
}



function isGasStorable(t) {
  const d = elementDefinition(t);
  if (!d) return false;
  return d.matterType === GAS_MATTER_TYPE;
}

function gasInputCells(structure) {
  const cells = [];
  const y = structure.y + FOOTPRINT;
  for (let i = 0; i < FOOTPRINT; i++) {
    cells.push({ x: structure.x + i, y });
  }
  return cells;
}

function gasOutputCells(structure) {
  const cells = [];
  const y = structure.y - 1;
  for (let i = 0; i < FOOTPRINT; i++) {
    cells.push({ x: structure.x + i, y });
  }
  return cells;
}

function captureInputsGas(structure, processor) {
  for (const cell of gasInputCells(structure)) {
    let t = null;

    try {
      t = processor.getElementTypeAtCell(cell.x, cell.y);
    } catch (_) {
      continue;
    }

    if (t === null || t === undefined) continue;
    if (!isGasStorable(t)) continue;

    const locked = lockedType(structure);
    if (locked !== null && locked !== t) continue;

    if (tryConsumeAt(processor, cell.x, cell.y, t)) {
      addToBuffer(structure, t, 1);
      structure.data.siloLastIntakeAt = Date.now();
      try {
        api.world.reportActivityAtCell(cell.x, cell.y);
      } catch (_) {}
    }
  }
}

function dispenseOutputsGas(structure, processor) {
  const t = lockedType(structure);
  if (t === null || storedCount(structure) <= 0) return;

  for (const cell of gasOutputCells(structure)) {
    if (storedCount(structure) <= 0) break;

    let occupied = true;

    try {
      occupied = processor.getElementTypeAtCell(cell.x, cell.y) !== null;
    } catch (_) {
      occupied = true;
    }

    if (occupied) continue;

    let created = false;
    try {
      created = processor.commit([
        {
          kind: "create",
          cellX: cell.x,
          cellY: cell.y,
          elementType: t,
        },
      ]);
    } catch (_) {
      created = false;
    }

    if (created) {
      removeFromBuffer(structure, 1);
      structure.data.siloLastOutputAt = Date.now();
      try {
        api.world.reportActivityAtCell(cell.x, cell.y);
      } catch (_) {}
    }
  }
}

const gasInteriorSweepCursor = new Map();

function sweepInteriorGas(structure, processor) {
  const key = posKey(structure.x, structure.y);
  let cursor = gasInteriorSweepCursor.get(key) || 0;

  const total = FOOTPRINT * FOOTPRINT;
  const locked = lockedType(structure);

  for (let n = 0; n < INTERIOR_SWEEP_BUDGET_PER_TICK; n++) {
    const idx = (cursor + n) % total;
    const dx = idx % FOOTPRINT;
    const dy = Math.floor(idx / FOOTPRINT);
    const x = structure.x + dx;
    const y = structure.y + dy;

    let t = null;
    try {
      t = processor.getElementTypeAtCell(x, y);
    } catch (_) {
      continue;
    }

    if (t === null || t === undefined) continue;


    if (isGasStorable(t) && (locked === null || locked === t)) {
      if (tryConsumeAt(processor, x, y, t)) {
        addToBuffer(structure, t, 1);
        try {
          api.world.reportActivityAtCell(x, y);
        } catch (_) {}
      }
    } else {
      continue;
    }
  }

  gasInteriorSweepCursor.set(
    key,
    (cursor + INTERIOR_SWEEP_BUDGET_PER_TICK) % total
  );
}

function processGasSilo(structure, processor) {
  if (!structure) return;


  dispenseOutputsGas(structure, processor);
  captureInputsGas(structure, processor);
  sweepInteriorGas(structure, processor);
}

function drawGasPlacementPreview(e) {
  try {
    if (
      !e ||
      !e.session ||
      !e.session.building ||
      e.session.building.activeStructureType !== GAS_STRUCTURE_ID ||
      e.session.building.placing
    ) {
      return;
    }

    const mouse = e.session.input && e.session.input.mouse
      ? e.session.input.mouse.cellPosition
      : null;
    if (!mouse) return;

    const metrics = api.rendering.getGridMetrics();
    const cellSize = (metrics && metrics.cellSize) || 4;

    const SNAP = 4;
    const snappedX = SNAP * Math.floor(mouse.x / SNAP);
    const snappedY = SNAP * Math.floor(mouse.y / SNAP);

    const screenX = snappedX * cellSize - e.session.camera.x;
    const screenY = snappedY * cellSize - e.session.camera.y;
    const fieldSize = FOOTPRINT * cellSize;

    const ctx = e.session.rendering && e.session.rendering.overlayContext;
    if (!ctx) return;

    ctx.save();

    ctx.fillStyle = "rgba(120,200,255,0.10)";
    ctx.strokeStyle = "rgba(120,200,255,0.92)";
    ctx.lineWidth = Math.max(1, cellSize * 0.24);
    ctx.setLineDash([Math.max(5, cellSize * 1.6), Math.max(3, cellSize)]);

    ctx.fillRect(screenX, screenY, fieldSize, fieldSize);
    ctx.strokeRect(screenX, screenY, fieldSize, fieldSize);

    ctx.restore();
  } catch (_) {}
}

function registerGasPlacementOverlay() {
  try {
    FH.misc.register(state, {
      id: "texGasSiloPlacementOverlay",
      afterRender: drawGasPlacementPreview,
    });

    console.log(`[${MOD_ID}] gas silo placement preview overlay registered`);
  } catch (err) {
    console.warn(`[${MOD_ID}] gas silo placement preview overlay failed:`, err);
  }
}

function ensureGasVisible() {
  try {
    const player = state && state.store && state.store.player;
    if (!player) return;

    player.buildings = Array.isArray(player.buildings)
      ? player.buildings
      : [];

    if (!player.buildings.includes(GAS_STRUCTURE_ID)) {
      player.buildings.push(GAS_STRUCTURE_ID);
    }

    try {
      api.player.buildings.unlockByType(GAS_STRUCTURE_ID);
    } catch (_) {}

    for (const panel of ["Management", "Hotbar", "TechTree"]) {
      try {
        FH.ui.update(state, panel);
      } catch (_) {}
    }
  } catch (err) {
    console.warn(`[${MOD_ID}] gas silo menu refresh failed`, err);
  }
}

function drawGasSilo(e, structure, context) {
  const ctx = context?.ctx;
  if (!ctx) return;
  try {
    const metrics = api.rendering.getGridMetrics();
    const cellSize = metrics?.cellSize || 4;
    const pos = api.rendering.getDrawPositionAtCell(structure.x, structure.y);
    drawCodeSilo(ctx, structure, pos.x, pos.y, FOOTPRINT * cellSize, true);
  } catch (_) {}
}




const siloMaterialColorCache=new Map();

function clampByte(v){
  v=Number(v);
  return Number.isFinite(v)?Math.max(0,Math.min(255,Math.round(v))):128;
}

function colorFromElementType(type,name){
  if(type===null||type===undefined)return {r:70,g:80,b:90,a:150};
  const key=String(type);
  const cached=siloMaterialColorCache.get(key);
  if(cached)return cached;
  let out=null;
  try{
    const def=elementDefinition(type);
    const variants=def?.colors?.variants;
    if(Array.isArray(variants)&&variants.length){
      const v=variants[0];
      if(Array.isArray(v)&&v.length>=3){
        out={r:clampByte(v[0]),g:clampByte(v[1]),b:clampByte(v[2]),a:clampByte(v[3]??210)};
      }
    }
    if(!out&&Number.isFinite(def?.metaColor)){
      const c=Number(def.metaColor)>>>0;
      out={r:(c>>16)&255,g:(c>>8)&255,b:c&255,a:210};
    }
  }catch(_){}
  if(!out){
    let h=2166136261;
    const text=String(name||key);
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
    out={r:72+((h>>>16)&127),g:72+((h>>>8)&127),b:72+(h&127),a:205};
  }
  siloMaterialColorCache.set(key,out);
  return out;
}

function drawWarehouseBaseCore(ctx,x,y,size,isGas){
  ctx.fillStyle="#11161b";
  ctx.fillRect(x,y,size,size);
  ctx.fillStyle="#202932";
  ctx.fillRect(x+size*0.04,y+size*0.04,size*0.92,size*0.92);

  ctx.fillStyle="#0b0e12";
  ctx.fillRect(x+size*0.08,y+size*0.10,size*0.84,size*0.80);
  ctx.strokeStyle="#67737d";
  ctx.lineWidth=Math.max(1,size*0.018);
  ctx.strokeRect(x+size*0.08,y+size*0.10,size*0.84,size*0.80);

  ctx.fillStyle="#f1b51c";
  const rail=Math.max(1,size*0.035);
  ctx.fillRect(x,y,size,rail);
  ctx.fillRect(x,y+size-rail,size,rail);

  ctx.fillStyle="#39444d";
  for(let i=0;i<4;i++){
    const bx=x+size*(0.08+i*0.24);
    ctx.fillRect(bx,y+size*0.06,size*0.035,size*0.88);
  }

  ctx.fillStyle=isGas?"#5aa8d8":"#d4a524";
  ctx.fillRect(x+size*0.18,y+size*0.05,size*0.64,size*0.045);
  ctx.fillStyle="#4fc47d";
  ctx.fillRect(x+size*0.18,y+size*0.89,size*0.64,size*0.045);
}

function drawWarehouseBase(ctx,x,y,size,isGas){
  ctx.save();
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation="source-over";
  try{ctx.filter="none";}catch(_){}
  if(isGas){
    ctx.translate(0,2*y+size);
    ctx.scale(1,-1);
  }
  drawWarehouseBaseCore(ctx,x,y,size,false);
  ctx.restore();
}

function drawSiloLabel(ctx,structure,x,y,size){
  const name=structure.data?.siloTypeName||"Empty";
  const count=storedCount(structure).toLocaleString();
  const cx=x+size*0.5, cy=y+size*0.515;
  const w=size*0.72, h=size*0.34, max=w*0.92, gap=h*0.27;
  ctx.fillStyle="rgba(7,9,11,0.64)";
  ctx.fillRect(cx-w/2,cy-h/2,w,h);
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  cachedOverlayFont(ctx,`n|${Math.round(size)}|${name}`,name,max,Math.round(size*0.19),Math.max(9,Math.round(size*0.075)),px=>`${px}px sans-serif`);
  ctx.fillStyle="#cfd8e3";
  ctx.fillText(name,cx,cy-gap);
  cachedOverlayFont(ctx,`c|${Math.round(size)}|${count}`,count,max,Math.round(size*0.18),Math.max(8,Math.round(size*0.065)),px=>`bold ${px}px sans-serif`);
  ctx.fillStyle="#fff";
  ctx.fillText(count,cx,cy+gap);
}

function drawCodeSilo(ctx,structure,x,y,size,isGas){
  ctx.save();
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation="source-over";
  try{ctx.filter="none";}catch(_){}
  ctx.shadowBlur=0;
  drawWarehouseBase(ctx,x,y,size,isGas);
  if(isGas){
    ctx.save();
    ctx.translate(0,2*y+size);
    ctx.scale(1,-1);
    drawSiloGlassTank(ctx,structure,x,y,size,false);
    ctx.restore();
  }else{
    drawSiloGlassTank(ctx,structure,x,y,size,false);
  }
  drawSiloFlowAnimation(ctx,structure,x,y,size,isGas);
  drawSiloLabel(ctx,structure,x,y,size);
  ctx.restore();
}

function drawSiloGlassTank(ctx,structure,screenX,screenY,size,isGas){
  const type=structure.data?.siloType;
  const name=structure.data?.siloTypeName||"Empty";
  const count=storedCount(structure);
  const c=colorFromElementType(type,name);
  const x=screenX+size*0.12;
  const y=screenY+size*0.24;
  const w=size*0.76;
  const h=size*0.52;
  const pad=Math.max(1,size*0.018);
  const now=Date.now();
  ctx.save();
  ctx.fillStyle="rgba(4,7,10,0.88)";
  ctx.fillRect(x-pad*2,y-pad*2,w+pad*4,h+pad*4);
  ctx.strokeStyle="rgba(185,205,218,0.92)";
  ctx.lineWidth=Math.max(1,size*0.012);
  ctx.strokeRect(x-pad,y-pad,w+pad*2,h+pad*2);
  ctx.fillStyle="rgba(125,170,190,0.12)";
  ctx.fillRect(x,y,w,h);
  if(count>0&&type!==null&&type!==undefined){
    if(isGas){
      const pulse=0.10+0.05*Math.sin(now/320);
      ctx.fillStyle=`rgba(${c.r},${c.g},${c.b},${Math.min(0.58,(c.a/255)*0.44+pulse)})`;
      ctx.fillRect(x+pad,y+pad,w-pad*2,h-pad*2);
      ctx.fillStyle=`rgba(${Math.min(255,c.r+45)},${Math.min(255,c.g+45)},${Math.min(255,c.b+45)},0.22)`;
      for(let i=0;i<4;i++){
        const bx=x+w*(0.18+i*0.21);
        const by=y+h*(0.25+0.12*Math.sin(now/420+i));
        ctx.beginPath();ctx.arc(bx,by,Math.max(1,size*0.018),0,Math.PI*2);ctx.fill();
      }
    }else{
      const wave=Math.sin(now/240)*size*0.008;
      const top=y+h*0.10+wave;
      ctx.fillStyle=`rgba(${c.r},${c.g},${c.b},${Math.min(0.78,(c.a/255)*0.72)})`;
      ctx.fillRect(x+pad,top,w-pad*2,y+h-pad-top);
      ctx.fillStyle=`rgba(${Math.min(255,c.r+55)},${Math.min(255,c.g+55)},${Math.min(255,c.b+55)},0.42)`;
      ctx.fillRect(x+pad,top,w-pad*2,Math.max(1,size*0.018));
    }
  }
  ctx.fillStyle="rgba(225,245,255,0.20)";
  ctx.fillRect(x+w*0.12,y+h*0.08,Math.max(1,w*0.10),h*0.70);
  ctx.fillStyle="rgba(255,255,255,0.08)";
  ctx.fillRect(x+w*0.68,y+h*0.10,Math.max(1,w*0.05),h*0.30);
  ctx.restore();
}

const siloOverlayFontCache=new Map();
const SILO_OVERLAY_FONT_CACHE_MAX=512;

function cachedOverlayFont(ctx,key,text,maxWidth,maxSize,minSize,fontBuilder){
  const cached=siloOverlayFontCache.get(key);
  if(cached){
    ctx.font=cached;
    return cached;
  }
  const px=fitFontSize(ctx,text,maxWidth,maxSize,minSize,fontBuilder);
  const font=ctx.font;
  if(siloOverlayFontCache.size>=SILO_OVERLAY_FONT_CACHE_MAX){
    const first=siloOverlayFontCache.keys().next().value;
    if(first!==undefined)siloOverlayFontCache.delete(first);
  }
  siloOverlayFontCache.set(key,font);
  return font;
}


function drawSiloFlowAnimation(ctx,structure,screenX,screenY,size,isGas){
  const now=Date.now();
  const intakeActive=now-Number(structure.data?.siloLastIntakeAt||0)<350;
  const outputActive=now-Number(structure.data?.siloLastOutputAt||0)<350;
  if(!intakeActive&&!outputActive)return;

  const phase=(now%600)/600;
  const arrowW=Math.max(2,size*0.035);
  const arrowH=Math.max(3,size*0.055);
  const drawBand=(y,active,dir,color)=>{
    if(!active)return;
    ctx.save();
    ctx.globalAlpha=0.65+0.25*Math.sin(phase*Math.PI*2);
    ctx.fillStyle=color;
    for(let i=0;i<5;i++){
      const x=screenX+size*(0.22+i*0.14);
      const yy=y+(phase*size*0.025*dir);
      ctx.beginPath();
      if(dir>0){
        ctx.moveTo(x-arrowW,yy-arrowH);ctx.lineTo(x+arrowW,yy-arrowH);ctx.lineTo(x,yy+arrowH);
      }else{
        ctx.moveTo(x-arrowW,yy+arrowH);ctx.lineTo(x+arrowW,yy+arrowH);ctx.lineTo(x,yy-arrowH);
      }
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
  };
  if(isGas){
    drawBand(screenY+size*0.91,intakeActive,-1,"#4d9fd0");
    drawBand(screenY+size*0.08,outputActive,-1,"#55c985");
  }else{
    drawBand(screenY+size*0.08,intakeActive,1,"#4d9fd0");
    drawBand(screenY+size*0.91,outputActive,1,"#55c985");
  }
}

function drawOneSiloOverlay(e,structure,isGas,frame){
  const ctx=frame?.ctx;
  if(!ctx||!structure)return;
  const size=frame.size;
  const x=structure.x*frame.cellSize-frame.cameraX;
  const y=structure.y*frame.cellSize-frame.cameraY;
  if(x+size < -size || y+size < -size || x > frame.canvasW+size || y > frame.canvasH+size)return;
  drawCodeSilo(ctx,structure,x,y,size,isGas);
}

function drawSilosAfterWorld(e){
  try{
    const ctx=e?.session?.rendering?.overlayContext;
    if(!ctx)return;

    const metrics=api.rendering.getGridMetrics();
    const cellSize=(metrics&&metrics.cellSize)||4;
    const frame={
      ctx,
      cellSize,
      size:FOOTPRINT*cellSize,
      cameraX:e.session.camera.x,
      cameraY:e.session.camera.y,
      canvasW:ctx.canvas?.width||0,
      canvasH:ctx.canvas?.height||0
    };

    api.structures.forEachOfType(
      STRUCTURE_ID,
      structure=>drawOneSiloOverlay(e,structure,false,frame)
    );
    api.structures.forEachOfType(
      GAS_STRUCTURE_ID,
      structure=>drawOneSiloOverlay(e,structure,true,frame)
    );
  }catch(_){}
}

function registerSiloOverlayRenderer() {
  try {
    FH.misc.register(
      state,
      {
        id:
          "texResourceSilo55OverlayRenderer",
        afterRender:
          drawSilosAfterWorld,
      }
    );

    console.log(
      `[${MOD_ID}] Sandustry compatible per-frame silo overlay renderer registered`
    );
  } catch (err) {
    console.warn(
      `[${MOD_ID}] silo overlay renderer registration failed:`,
      err
    );
  }
}



function isFootprintCellEmpty(x, y) {
  try {
    if (
      !FH.world.isCellEmpty(
        state,
        x,
        y
      )
    ) {
      return false;
    }
  } catch (_) {
    return false;
  }

  try {
    if (
      FH.structures.hasBuiltAtCell(
        state,
        x,
        y
      )
    ) {
      return false;
    }
  } catch (_) {}

  return true;
}

function isSiloFootprintClear(
  originX,
  originY
) {
  for (
    let dy = 0;
    dy < FOOTPRINT;
    dy++
  ) {
    for (
      let dx = 0;
      dx < FOOTPRINT;
      dx++
    ) {
      if (
        !isFootprintCellEmpty(
          originX + dx,
          originY + dy
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

function registerPlacementSafety() {
  try {
    FH.hooks.intercept(
      state,
      "building:place",
      (e, args, control) => {
        if (
          !args ||
          (
            args.structureId !== STRUCTURE_ID &&
            args.structureId !== GAS_STRUCTURE_ID
          )
        ) {
          return;
        }

        if (
          !isSiloFootprintClear(
            args.x,
            args.y
          )
        ) {
          control.cancel();

          try {
            FH.ui.toast(
              e,
              {
                message:
                  "Resource Silos require a completely empty 5x5 placement area."
              }
            );
          } catch (_) {}
        }
      },
      {
        structureTypes: [
          STRUCTURE_ID,
          GAS_STRUCTURE_ID
        ]
      }
    );

    console.log(
      `[${MOD_ID}] full-footprint placement safety registered`
    );
  } catch (err) {
    console.warn(
      `[${MOD_ID}] placement safety registration failed:`,
      err
    );
  }
}



function drawPlacementPreview(e) {
  try {
    if (
      !e ||
      !e.session ||
      !e.session.building ||
      e.session.building.activeStructureType !== STRUCTURE_ID ||
      e.session.building.placing
    ) {
      return;
    }

    const mouse = e.session.input && e.session.input.mouse
      ? e.session.input.mouse.cellPosition
      : null;
    if (!mouse) return;

    const metrics = api.rendering.getGridMetrics();
    const cellSize = (metrics && metrics.cellSize) || 4;

    const SNAP = 4;
    const snappedX = SNAP * Math.floor(mouse.x / SNAP);
    const snappedY = SNAP * Math.floor(mouse.y / SNAP);

    const screenX = snappedX * cellSize - e.session.camera.x;
    const screenY = snappedY * cellSize - e.session.camera.y;
    const fieldSize = FOOTPRINT * cellSize;

    const ctx = e.session.rendering && e.session.rendering.overlayContext;
    if (!ctx) return;

    ctx.save();

    const footprintClear =
      isSiloFootprintClear(
        snappedX,
        snappedY
      );

    ctx.fillStyle = footprintClear
      ? "rgba(90,220,120,0.10)"
      : "rgba(255,70,70,0.16)";

    ctx.strokeStyle = footprintClear
      ? "rgba(90,220,120,0.95)"
      : "rgba(255,70,70,0.98)";
    ctx.lineWidth = Math.max(1, cellSize * 0.24);
    ctx.setLineDash([Math.max(5, cellSize * 1.6), Math.max(3, cellSize)]);

    ctx.fillRect(screenX, screenY, fieldSize, fieldSize);
    ctx.strokeRect(screenX, screenY, fieldSize, fieldSize);

    ctx.restore();
  } catch (_) {}
}

function registerPlacementOverlay() {
  try {
    FH.misc.register(state, {
      id: "texResourceSiloPlacementOverlay",
      afterRender: drawPlacementPreview,
    });

    console.log(`[${MOD_ID}] placement preview overlay registered`);
  } catch (err) {
    console.warn(`[${MOD_ID}] placement preview overlay failed:`, err);
  }
}


function ensureVisible() {
  try {
    const player = state && state.store && state.store.player;
    if (!player) return;

    player.buildings = Array.isArray(player.buildings)
      ? player.buildings
      : [];

    if (!player.buildings.includes(STRUCTURE_ID)) {
      player.buildings.push(STRUCTURE_ID);
    }

    try {
      api.player.buildings.unlockByType(STRUCTURE_ID);
    } catch (_) {}

    for (const panel of ["Management", "Hotbar", "TechTree"]) {
      try {
        FH.ui.update(state, panel);
      } catch (_) {}
    }
  } catch (err) {
    console.warn(`[${MOD_ID}] menu refresh failed`, err);
  }
}

function drawSilo(e, structure, context) {
  const ctx = context?.ctx;
  if (!ctx) return;
  try {
    const metrics = api.rendering.getGridMetrics();
    const cellSize = metrics?.cellSize || 4;
    const pos = api.rendering.getDrawPositionAtCell(structure.x, structure.y);
    drawCodeSilo(ctx, structure, pos.x, pos.y, FOOTPRINT * cellSize, false);
  } catch (_) {}
}


async function main() {
  try {
    await api.sprites.loadFromMod(ICON16_ID, "assets/resource_silo_icon16.png");
    await api.sprites.loadFromMod(GAS_ICON16_ID, "assets/gas_silo_icon16.png");
  } catch (err) {
    console.warn(`[${MOD_ID}] icon load failed:`, err);
  }

  
  try {
    if (api.i18n && api.i18n.register) {
      api.i18n.register("en", {
        "mods|resourceSilo|tooltip": "{material}: {amount}",
      });
    }
  } catch (err) {
    console.warn(`[${MOD_ID}] i18n registration failed:`, err);
  }

  const shape = [];
  for (let y = 0; y < FOOTPRINT; y++) {
    shape.push(new Array(FOOTPRINT).fill(1));
  }

  try {
    api.structures.register(
      {
        id: STRUCTURE_ID,
        blockGridType: STRUCTURE_ID,
        name: "Resource Silo",
        description: "Stores one material type. Top intake, bottom output. Native Collector: Gold, Liquid Gold, and Gold Granulate stored here are added to the native Gold balance and can be spent normally.",
        categoryKey: "logistics",
        order: 95,
        alwaysUnlocked: false,
        unlockedBy: "tex.resource-silo.research",
        rejectWhenBlocked: true,

        copyData: false,
        buildModes: [{ type: "single" }],
        variants: [{ id: STRUCTURE_ID, angles: [0] }],
        shape,
        render: {
          imageName: ICON16_ID,
          size: { width: 16, height: 16 },
          offset: { x: 0, y: 0 },
          ui: { outline: true, width: "16px", height: "16px" }
        },
        draw: drawSilo,
        tooltipHover: {
          type: "custom",
          dataFieldMessage: {
            messageKey: "mods|resourceSilo|tooltip",
            fields: [
              { param: "material", field: "siloTypeName", fallback: "Empty" },
              { param: "amount", field: "siloCount", round: true, fallback: 0 },
            ],
          },
        },
        defaultData: {
          siloType: null,
          siloTypeName: "Empty",
          siloCount: 0,
          siloCurrencyValue: 0,
        },
      },
      { useRawShape: true }
    );

    console.log(`[${MOD_ID}] structure registered`);
  } catch (err) {
    console.error(`[${MOD_ID}] structure registration failed:`, err);
    return;
  }

  try {
    api.structures.addProcessor(STRUCTURE_ID, {
      intervalMs: PROCESS_INTERVAL_MS,
      process: processSilo,
    });

    console.log(
      `[${MOD_ID}] processor attached at ${PROCESS_INTERVAL_MS}ms`
    );
  } catch (err) {
    console.error(`[${MOD_ID}] processor registration failed:`, err);
  }

  const gasShape = [];
  for (let y = 0; y < FOOTPRINT; y++) {
    gasShape.push(new Array(FOOTPRINT).fill(1));
  }

  try {
    api.structures.register(
      {
        id: GAS_STRUCTURE_ID,
        blockGridType: GAS_STRUCTURE_ID,
        name: "Gas Silo",
        description: "Stores one gas type. Bottom intake, top output.",
        categoryKey: "logistics",
        order: 96,
        alwaysUnlocked: false,
        unlockedBy: "tex.resource-silo.research",
        rejectWhenBlocked: true,

        copyData: false,
        buildModes: [{ type: "single" }],
        variants: [{ id: GAS_STRUCTURE_ID, angles: [0] }],
        shape: gasShape,
        render: {
          imageName: GAS_ICON16_ID,
          size: { width: 16, height: 16 },
          offset: { x: 0, y: 0 },
          ui: { outline: true, width: "16px", height: "16px" }
        },
        draw: drawGasSilo,
        tooltipHover: {
          type: "custom",
          dataFieldMessage: {
            messageKey: "mods|resourceSilo|tooltip",
            fields: [
              { param: "material", field: "siloTypeName", fallback: "Empty" },
              { param: "amount", field: "siloCount", round: true, fallback: 0 },
            ],
          },
        },
        defaultData: {
          siloType: null,
          siloTypeName: "Empty",
          siloCount: 0,
          siloCurrencyValue: 0,
        },
      },
      { useRawShape: true }
    );

    console.log(`[${MOD_ID}] gas silo structure registered`);
  } catch (err) {
    console.error(`[${MOD_ID}] gas silo structure registration failed:`, err);
  }

  try {
    api.structures.addProcessor(GAS_STRUCTURE_ID, {
      intervalMs: PROCESS_INTERVAL_MS,
      process: processGasSilo,
    });

    console.log(
      `[${MOD_ID}] gas silo processor attached at ${PROCESS_INTERVAL_MS}ms`
    );
  } catch (err) {
    console.error(`[${MOD_ID}] gas silo processor registration failed:`, err);
  }

  registerPlacementOverlay();
  registerGasPlacementOverlay();
  registerPlacementSafety();
  registerSiloOverlayRenderer();


  try {
    FH.events.on(state, "mods:internal-ready", () => {
    });
  } catch (_) {}

  try {
    FH.events.on(state, "game:ready", () => {

      const siloCoins =
        reconcileSiloCurrency();

      console.log(
        `[${MOD_ID}] Native Gold sync total: ${siloCoins ?? 0} coins`
      );
    });
  } catch (_) {}

  setTimeout(() => {
    reconcileSiloCurrency();
  }, 1000);

  setInterval(() => {
    reconcileSiloCurrency();
  }, 500);
}

main().catch((err) => {
  console.error(`[${MOD_ID}] unexpected top-level error:`, err);
});


(() => {
  const MRF_TECH_ID = "tex.resource-silo.research";

  const registerResearchDefinition = (techId, definition) => {
    const techApi = sandkit.engine.api.tech;
    const hasMRF =
      typeof techApi.getMRFInfo === "function" &&
      (() => {
        try {
          const info = techApi.getMRFInfo();
          return info && info.id === "tex.mod-research-framework";
        } catch (_) {
          return false;
        }
      })();

    if (hasMRF) {
      techApi.addDefinition(techId, definition);
      return "mrf";
    }

    const vanillaDefinition = { ...definition };
    const mrfMeta = vanillaDefinition.modResearch || vanillaDefinition.modResearchFramework || {};
    delete vanillaDefinition.modResearch;
    delete vanillaDefinition.modResearchFramework;

    if (!vanillaDefinition.branch) {
      const branchMap = {
        processing: "refining",
        refining: "refining",
        thermal: "heat",
        logistics: "logistics",
        storage: "logistics",
        automation: "logistics",
        extraction: "excavation",
        excavation: "excavation",
        utility: "tools",
        misc: "tools",
        power: "electricity",
        electricity: "electricity",
        fluids: "fluids",
        endgame: "alien"
      };
      vanillaDefinition.branch = branchMap[mrfMeta.category] || "tools";
    }

    if (vanillaDefinition.branch === "electricity") {
      vanillaDefinition.isElectricity = true;
      vanillaDefinition.electricityNodeStyle = true;
    }

    const requirements = vanillaDefinition.requires;
    let parentId = Array.isArray(requirements) ? requirements[0] : requirements;
    if (parentId == null) {
      try {
        parentId = sandkit.enums.Tech.Shaker;
      } catch (_) {}
    }
    if (parentId == null) parentId = 0;

    techApi.registerNode(
      techId,
      vanillaDefinition,
      { parentId }
    );
    return "vanilla";
  };

  try {
    registerResearchDefinition(
      MRF_TECH_ID,
      {
        name: "Resource Silo",
        description: "Unlocks Resource and Gas Silos.",
        cost: 50000,
        currencyType: "gold",
        requires: 2,
        unlocks: {"structures": ["texResourceSilo", "texGasSilo"]},
        modResearch: {
          apiVersion: 1,
          modId: "tex.resource-silo",
          category: "storage",
          name: "Resource Silo",
          description: "Unlocks Resource and Gas Silos.",
          parentId: 2
        }
      }
    );
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!message.toLowerCase().includes("already")) {
      console.warn(
        "[tex.resource-silo] Mod Research Framework registration failed",
        error
      );
    }
  }
})();
