// server.js
require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const { GoogleGenAI } = require('@google/genai');

// ================= CONFIG =================
const config = {
  host: process.env.SERVER_ADDRESS || '15.204.142.106',
  port: parseInt(process.env.SERVER_PORT || '26188', 10),
  username: process.env.BOT_USERNAME || 'ChatGPT',
  auth: 'offline',
  version: process.env.MC_VERSION || '1.21.8',
  rootPlayerName: process.env.ROOT_PLAYER || 'ROOT_SKYT',
  operatorList: process.env.OPERATORS || 'operatorlist',
  geminiApiKey: process.env.GEMINI_API_KEY || "AIzaSyDtFqe6NtmmAAXOIYrnfWUCJ5iWy1omAzs",
  scanIntervalMs: 1500,
  pickupRange: 12,
  attackRange: 3.5,
  dangerAvoidDistance: 8
};

// ================ GEMINI ================
const genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });

// ================ GLOBALS ================
let bot = null;
let mcData = null;
let isAttacking = false;
let reconnectTimer = null;
let isShuttingDown = false;
let lastTeleportTime = 0; // <--- cooldown tracker for /tp ROOT_SKYT

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ================= BOT CREATION =================
function createBot() {
  console.log('Creating bot connection...');
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth
  });

  bot.loadPlugin(pathfinder);

  bot.on('login', () => console.log('✅ Logged in as', bot.username));
  bot.on('error', err => console.error('Bot error:', err.message));

  bot.on('spawn', () => {
    try { mcData = require('minecraft-data')(bot.version); } catch {}
    console.log('Spawned — starting main AI loop');
    const moves = new Movements(bot, mcData);
    bot.pathfinder.setMovements(moves);
    mainLoop();
  });

  bot.on('playerJoined', (p) => {
    if (p && p.username) bot.chat(`Welcome ${p.username}! The Server Owner is ${config.operatorList}`);
  });

  bot.on('chat', async (u, msg) => {
    if (!msg || u === bot.username) return;
    if (msg.toLowerCase().startsWith('chat!')) {
      const q = msg.slice(5).trim();
      if (!q) return bot.chat('Please type message after "chat!"');
      try {
        const reply = await askGemini(q);
        bot.chat(reply);
      } catch {
        bot.chat('Gemini unavailable.');
      }
    }
  });

  bot.on('end', () => {
    if (isShuttingDown) return;
    console.log('Disconnected — Reconnecting in 5s');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(createBot, 5000);
  });
}

// ================= HELPER FUNCTIONS =================
function isAnimalTarget(e) {
  const n = e?.name?.toLowerCase() || '';
  return n === 'pig' || n === 'sheep';
}
function isHostile(e) {
  const n = e?.name?.toLowerCase() || '';
  return n.includes('creeper') || n.includes('zombie');
}
function findClosest(filter, range = 40) {
  const arr = Object.values(bot.entities).filter(e => e.position && filter(e));
  arr.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  return arr.find(e => e.position.distanceTo(bot.entity.position) <= range) || null;
}
function findAnimal() { return findClosest(isAnimalTarget, 40); }
function findDanger() { return findClosest(isHostile, config.dangerAvoidDistance); }
function findDrop() {
  const ents = Object.values(bot.entities).filter(e => e?.item && e.position.distanceTo(bot.entity.position) < config.pickupRange);
  ents.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  return ents[0] || null;
}

// ================= GEMINI CHAT =================
async function askGemini(text) {
  const res = await genAI.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `User: ${text}\nReply as a player in minecraft named ChatGPT trained by SUNNY KUMAR in hindi.`,
    generationConfig: { maxOutputTokens: 200, temperature: 0.4 }
  });
  return res.text?.trim() || 'Gemini reply error.';
}

// ================= COMBAT & MOVEMENT =================
async function fleeFrom(ent) {
  if (!ent?.position) return;
  const my = bot.entity.position;
  const away = my.minus(ent.position);
  const len = Math.hypot(away.x, away.z) || 1;
  const target = my.offset((away.x / len) * 8, 0, (away.z / len) * 8);
  bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 2.5));
  await sleep(4000);
  bot.pathfinder.setGoal(null);
}

async function attackAnimal(ent) {
  if (!ent || isAttacking || !isAnimalTarget(ent)) return;
  isAttacking = true;
  try {
    bot.pathfinder.setGoal(new GoalNear(ent.position.x, ent.position.y, ent.position.z, 1.8));
    while (ent.isValid && ent.health > 0) {
      const danger = findDanger();
      if (danger) { await fleeFrom(danger); break; }
      await bot.lookAt(ent.position.offset(0, ent.height / 2, 0));
      if (bot.entity.position.distanceTo(ent.position) <= config.attackRange) bot.attack(ent);
      await sleep(400);
    }
  } catch (e) { console.error('attackAnimal:', e.message); }
  bot.pathfinder.setGoal(null);
  isAttacking = false;
}

// ================= EAT & CRAFT BED =================
async function eatIfLow() {
  if (bot.food > 12 && bot.health > 10) return;
  const food = bot.inventory.items().find(i =>
    ['bread', 'apple', 'cooked', 'carrot', 'potato'].some(f => i.name.includes(f))
  );
  if (!food) return;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log('🍞 Ate', food.name);
  } catch {}
}

async function craftBed() {
  if (!mcData) return;
  const hasBed = bot.inventory.items().some(i => i.name.endsWith('_bed'));
  if (hasBed) return;
  const bed = mcData.itemsArray.find(i => i.name === 'white_bed');
  if (!bed) return;
  const recipes = bot.recipesFor(bed.id, null, 1);
  if (!recipes.length) return;
  try {
    await bot.craft(recipes[0], 1, null);
    console.log('🛏️ Crafted bed');
  } catch {}
}

async function sleepIfNight() {
  const t = bot.time.timeOfDay;
  if (t < 13000 || t > 23000) return;
  const bed = bot.inventory.items().find(i => i.name.endsWith('_bed'));
  if (!bed) return;
  try {
    await bot.equip(bed, 'hand');
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    await bot.placeBlock(below, new Vec3(0, 1, 0));
    await sleep(500);
    console.log('🛏️ Placed bed for sleep attempt');
  } catch {}
}

// ================= LOOT & TELEPORT =================
async function collectDrop() {
  const drop = findDrop();
  if (!drop) return false;
  try {
    bot.pathfinder.setGoal(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1.2));
    await sleep(1500);
    bot.pathfinder.setGoal(null);
    return true;
  } catch { bot.pathfinder.setGoal(null); return false; }
}

async function giveLootToRoot() {
  const root = config.rootPlayerName;
  const rootPlayer = bot.players[root]?.entity;
  const items = bot.inventory.items().filter(i => i.count > 0);
  if (!items.length) return;

  // --- Teleport every 10 minutes only ---
  const now = Date.now();
  if (now - lastTeleportTime > 600000) { // 10 min
    try { bot.chat(`/tp ${root}`); console.log('📡 /tp ROOT_SKYT (every 10 min)'); }
    catch {}
    lastTeleportTime = now;
  }

  // --- If ROOT_SKYT online, toss loot ---
  if (!rootPlayer) return;
  try {
    const pos = rootPlayer.position;
    bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 2.2));
    await sleep(2000);
    bot.pathfinder.setGoal(null);
    for (const item of items) {
      const name = item.name || '';
      if (/sword|pickaxe|axe|helmet|boots|leggings|chestplate/.test(name)) continue;
      await bot.tossStack(item);
      await sleep(200);
    }
  } catch (e) { bot.pathfinder.setGoal(null); }
}

// ================= MAIN LOOP =================
async function mainLoop() {
  while (bot && !isShuttingDown) {
    try {
      const danger = findDanger();
      if (danger) { console.log('⚠️ Danger:', danger.name); await fleeFrom(danger); }

      await eatIfLow();
      await craftBed();
      await sleepIfNight();

      if (await collectDrop()) { await giveLootToRoot(); await sleep(300); continue; }

      const target = findAnimal();
      if (target) { await attackAnimal(target); await collectDrop(); await giveLootToRoot(); continue; }

      // idle small move
      const yaw = Math.random() * Math.PI * 2;
      const dx = Math.cos(yaw) * 2, dz = Math.sin(yaw) * 2;
      bot.pathfinder.setGoal(new GoalNear(bot.entity.position.x + dx, bot.entity.position.y, bot.entity.position.z + dz, 1.3));
      await sleep(1200);
      bot.pathfinder.setGoal(null);
    } catch (e) { console.error('Loop err:', e.message); }
    await sleep(config.scanIntervalMs);
  }
}

// ================= EXIT HANDLING =================
process.on('SIGINT', () => {
  console.log('Graceful exit');
  isShuttingDown = true;
  bot.quit();
  setTimeout(() => process.exit(0), 1000);
});

// ================= START =================
createBot();    console.log('Spawned in world. Starting behaviors.');
    // Setup pathfinder movements
    try {
      const defaultMovements = new Movements(bot, mcData);
      bot.pathfinder.setMovements(defaultMovements);
    } catch (e) {
      // fallback if mcData missing
      try {
        bot.pathfinder.setMovements(new Movements(bot));
      } catch (e2) { /* ignore */ }
    }

    // Say hi
    try { bot.chat('Hello! ChatGPT bot online.'); } catch(e) {}

    // Start main loop
    mainLoop().catch(e => console.error('Main loop crashed:', e));

  // Welcome players
  bot.on('playerJoined', (player) => {
    if (!player || !player.username) return;
    const welcome = `Welcome ${player.username}! The Server Owner is ${config.operatorList}`;
    try { bot.chat(welcome); } catch(e) {}
    console.log('Welcomed', player.username);
  });

  // Chat handling for "chat!" -> Gemini
  bot.on('chat', async (username, message) => {
    if (!message || username === bot.username) return;
    if (message.trim().toLowerCase().startsWith('chat!')) {
      const userText = message.trim().slice(5).trim();
      if (!userText) {
        bot.chat('Please give message after "chat!"');
        return;
      }
      try {
        const reply = await askGemini(userText);
        bot.chat(reply);
      } catch (err) {
        console.error('Gemini error:', err);
        bot.chat('Gemini unavailable.');
      }
    }
  });

  // On disconnection, attempt reconnect
  bot.on('end', () => {
    if (isShuttingDown) return;
    console.log('Bot disconnected. Will reconnect in 5s...');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      try {
        createBot();
      } catch (e) {
        console.error('Reconnect failed:', e);
        reconnectTimer = setTimeout(createBot, 10000);
      }
    }, 5000);
  });

////////////////////////////////////
// --- GEMINI helper --------------
////////////////////////////////////
async function askGemini(text) {
  if (!genAI) return `gemini fallback: ${text}`;
  const prompt = `User said: ${text}\nReply briefly as Gemini would.`;
  const response = await genAI.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    generationConfig: { maxOutputTokens: 200, temperature: 0.3 }
  });
  const raw = response?.text || (Array.isArray(response?.candidates) && response.candidates[0]?.content?.[0]?.text) || '';
  return (raw || 'No reply from Gemini.').toString().trim();
}

////////////////////////////////////
// --- Combat: attack pigs/sheep -
////////////////////////////////////
async function attackAnimal(target) {
  if (!target || isAttacking) return;
  if (target.type === 'player') return;
  if (!isAnimalTarget(target)) return;

  isAttacking = true;
  try {
    bot.pathfinder.setGoal(new GoalNear(target.position.x, target.position.y, target.position.z, 1.8));
    while (target && target.isValid && target.health > 0) {
      // If a player is super close, pause to avoid touching
      const closePlayer = Object.keys(bot.players).find(n => n !== bot.username && bot.players[n]?.entity && bot.players[n].entity.position.distanceTo(bot.entity.position) < 2.5);
      if (closePlayer) {
        bot.pathfinder.setGoal(null);
        await sleep(500);
        continue;
      }

      // If any danger too close, break and flee
      const danger = findClosestDanger(6);
      if (danger) {
        bot.pathfinder.setGoal(null);
        await fleeFrom(danger);
        break;
      }

      try { await bot.lookAt(target.position.offset(0, target.height || 0.5, 0)); } catch(e){}

      const dist = bot.entity.position.distanceTo(target.position);
      if (dist <= config.attackRange) {
        try { bot.attack(target); } catch(e) {}
      } else {
        bot.pathfinder.setGoal(new GoalNear(target.position.x, target.position.y, target.position.z, 1.8));
      }
      await sleep(400);
    }
  } catch (err) {
    console.error('attackAnimal error:', err);
  } finally {
    bot.pathfinder.setGoal(null);
    isAttacking = false;
  }
}

////////////////////////////////////
// --- Fleeing / danger handling --
////////////////////////////////////
async function fleeFrom(entity) {
  if (!entity || !entity.position) return;
  try {
    const myPos = bot.entity.position;
    const mobPos = entity.position;
    // Vector from mob to bot
    const awayVec = myPos.minus(mobPos);
    // Normalize to length ~8
    const len = Math.sqrt(awayVec.x*awayVec.x + awayVec.z*awayVec.z) || 1;
    const scale = Math.max(6, config.dangerAvoidDistance);
    const target = myPos.offset((awayVec.x/len) * scale, 0, (awayVec.z/len) * scale);
    bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 2.5));
    // run for a short while
    const start = Date.now();
    while (Date.now() - start < 4500) {
      // if distance ok, break
      const d = bot.entity.position.distanceTo(entity.position);
      if (d > config.dangerAvoidDistance + 2) break;
      await sleep(300);
    }
  } catch (e) {
    console.warn('fleeFrom issue:', e?.message || e);
  } finally {
    bot.pathfinder.setGoal(null);
  }
}

////////////////////////////////////
// --- Collect items & give loot --
////////////////////////////////////
async function collectNearestDrop() {
  const drop = findClosestDroppedItem(config.pickupRange);
  if (!drop) return false;
  try {
    const pos = drop.position;
    bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 1.2));
    const start = Date.now();
    while (Date.now() - start < 6000) {
      const cur = Object.values(bot.entities).find(e => e?.id === drop.id);
      if (!cur) break;
      if (bot.entity.position.distanceTo(pos) <= 1.6) break;
      await sleep(200);
    }
    bot.pathfinder.setGoal(null);
    await sleep(200);
    return true;
  } catch (err) {
    console.error('collectNearestDrop error:', err);
    bot.pathfinder.setGoal(null);
    return false;
  }
}

async function giveLootToRoot() {
  const root = config.rootPlayerName;
  const rootPlayer = bot.players[root] && bot.players[root].entity ? bot.players[root].entity : null;
  const invItems = bot.inventory.items().filter(i => i.count > 0);
  if (invItems.length === 0) return;

  if (!rootPlayer) {
    // Root not online -> attempt teleport request via /to ROOT_SKYT then keep working
    try { bot.chat(`/tp ${root}`); } catch(e) {}
    return;
  }

  // Move near root
  try {
    const pos = rootPlayer.position;
    bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 2.2));
    const st = Date.now();
    while (Date.now() - st < 6000) {
      if (bot.entity.position.distanceTo(pos) <= 3.0) break;
      await sleep(200);
    }
    bot.pathfinder.setGoal(null);
  } catch (e) {
    bot.pathfinder.setGoal(null);
  }

  // Toss non-tools/non-armor items (loot)
  for (const item of bot.inventory.items()) {
    const name = item.name || '';
    const isArmor = /helmet|chestplate|leggings|boots/.test(name);
    const isTool = /sword|pickaxe|axe|shovel|hoe/.test(name);
    if (isArmor || isTool) continue;
    try {
      await bot.tossStack(item);
      await sleep(250);
    } catch (e) {
      try { await bot.toss(item.type, null, item.count); } catch(e2) {}
    }
  }
}

////////////////////////////////////
// --- Auto-eat & crafting bed -----
////////////////////////////////////
async function autoEatIfNeeded() {
  try {
    const needFood = (bot.food !== undefined && bot.food <= 12) || (bot.health !== undefined && bot.health <= 10);
    if (!needFood) return false;

    const foodItems = bot.inventory.items().filter(it => {
      const n = it.name || '';
      return ['bread','apple','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton','cooked_fish','cooked_salmon','potato','carrot'].some(f => n.includes(f));
    });

    if (foodItems.length === 0) return false;

    const food = foodItems[0];
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      console.log('Ate food:', food.name);
      return true;
    } catch (e) {
      console.warn('Failed to eat via equip/consume:', e.message || e);
      return false;
    }
  } catch (err) {
    console.error('autoEatIfNeeded error:', err);
    return false;
  }
}

async function tryCraftBedIfPossible() {
  if (!mcData) return false;
  // If already has a bed, no need to craft
  const hasBed = bot.inventory.items().some(i => i.name && i.name.includes('_bed'));
  if (hasBed) return true;

  // Try to find any bed recipe by checking mcData items that end with '_bed'
  const bedItems = mcData.itemsArray.filter(it => it.name && it.name.endsWith('_bed'));
  for (const bed of bedItems) {
    try {
      const recipes = bot.recipesFor(bed.id, null, 1);
      if (recipes && recipes.length > 0) {
        // ensure we have the recipe ingredients present
        const recipe = recipes[0];
        // Check if inventory contains required items approx (quick check)
        const needed = {};
        for (const ing of recipe.delta || recipe.ingredients || []) {
          // recipe.ingredients entry may be {id, count}
          const id = ing.id || ing[0];
          if (!id) continue;
          const itemName = mcData.items[id]?.name || '';
          needed[itemName] = (needed[itemName] || 0) + (ing.count || 1);
        }
        // Try craft (bot.craft handles inventory checks)
        try {
          await bot.craft(recipe, 1, null);
          console.log('Crafted bed:', bed.name);
          return true;
        } catch (e) {
          // craft failed for this recipe, continue trying others
          continue;
        }
      }
    } catch (e) {
      // ignore and try next bed type
      continue;
    }
  }
  return false;
}

// place bed next to bot and try to sleep
async function placeAndSleepIfNight() {
  try {
    // Determine night: time ticks roughly: night ~ 13000 - 23000
    const tod = bot.time.timeOfDay;
    if (tod >= 13000 && tod <= 23000) {
      // find a bed in inventory
      const bedItem = bot.inventory.items().find(i => i.name && i.name.endsWith('_bed'));
      if (!bedItem) return false;

      // find reference block (solid) to place bed on top of
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!below) return false;

      // attempt to place the bed on adjacent space (to avoid colliding with player)
      const placePos = bot.entity.position.offset(1, 0, 0);
      try {
        // ensure we have the item in hand
        await bot.equip(bedItem, 'hand');
        // place block relative to 'below' by targeting its top face
        await bot.placeBlock(below, new Vec3(0, 1, 0), bedItem);
        await sleep(500);
        // find the placed bed block (search nearby)
        const bedBlock = Object.values(bot.blocks).find(b => b && b.name && b.name.endsWith('_bed') && b.position.distanceTo(bot.entity.position) < 4);
        // Attempt to activate block to sleep (best-effort)
        if (bedBlock) {
          try {
            await bot.activateBlock(bedBlock);
            console.log('Attempted to sleep on bed.');
            await sleep(2500); // wait a bit while server processes sleep
            return true;
          } catch (e) {
            console.warn('activateBlock failed (sleep might not be supported):', e.message || e);
            return true; // count as placed
          }
        } else {
          return true; // placed but bedBlock detection failed
        }
      } catch (e) {
        console.warn('Failed to place/activate bed:', e.message || e);
        return false;
      }
    }
    return false;
  } catch (err) {
    console.error('placeAndSleepIfNight error:', err);
    return false;
  }
}

////////////////////////////////////
// --- Main loop ------------------
////////////////////////////////////
async function mainLoop() {
  while (bot && bot.entity && !isShuttingDown) {
    try {
      // Avoid mobs: if dangerous mob close, flee
      const danger = findClosestDanger();
      if (danger) {
        console.log('Danger detected:', danger.name, '-> fleeing');
        await fleeFrom(danger);
        await sleep(300);
        // After fleeing, attempt to eat if needed or place bed if night
        await autoEatIfNeeded();
        await tryCraftBedIfPossible();
        await placeAndSleepIfNight();
        await sleep(300);
        continue;
      }

      // Auto-eat priority
      await autoEatIfNeeded();

      // Try craft bed if resources available (A: craft automatically), and attempt to sleep if night
      await tryCraftBedIfPossible();
      await placeAndSleepIfNight();

      // Collect drops if any
      const picked = await collectNearestDrop();
      if (picked) {
        await giveLootToRoot();
        await sleep(300);
        continue;
      }

      // Attack nearest pig/sheep if present
      const animal = findClosestAnimal(40);
      if (animal) {
        await attackAnimal(animal);
        // after combat, collect drops and give them
        await sleep(200);
        await collectNearestDrop();
        await giveLootToRoot();
        await sleep(300);
        continue;
      }

      // Idle/wander peacefully but avoid players and dangers
      const nearbyPlayers = Object.keys(bot.players).filter(n => n !== bot.username);
      if (nearbyPlayers.length === 0) {
        // gentle wander a short distance
        const yaw = Math.random() * Math.PI * 2;
        const dx = Math.cos(yaw) * 2;
        const dz = Math.sin(yaw) * 2;
        const target = bot.entity.position.offset(dx, 0, dz);
        try {
          bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 1.3));
          await sleep(1200);
        } catch (e) {
          bot.pathfinder.setGoal(null);
        } finally {
          bot.pathfinder.setGoal(null);
        }
      } else {
        // if players around, stand guard and look around but don't move into them
        try { bot.look(bot.entity.yaw + (Math.random() - 0.5) * 0.6, 0); } catch(e){}
        await sleep(800);
      }
    } catch (err) {
      console.error('Error in main loop:', err);
    }
    await sleep(config.scanIntervalMs);
  }
}

////////////////////////////////////
// --- Shutdown handling ----------
////////////////////////////////////
process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down bot gracefully.');
  isShuttingDown = true;
  try { bot && bot.quit(); } catch(e) {}
  setTimeout(() => process.exit(0), 1500);
});

////////////////////////////////////
// --- Start up -------------------
////////////////////////////////////
createBot();
