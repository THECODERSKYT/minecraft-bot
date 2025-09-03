const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoogleGenAI } = require('@google/genai'); // Gemini API client
require('dotenv').config();

// Configuration for offline server
const config = {
  host: process.env.SERVER_ADDRESS || 'BlazeSMP01.aternos.me',
  port: parseInt(process.env.SERVER_PORT) || 37053,
  username: 'ChatGPT', // Bot name
  auth: 'offline', // Critical for offline servers
  version: '1.20.1'
};

// Initialize Google Gemini AI
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "AIzaSyDtFqe6NtmmAAXOIYrnfWUCJ5iWy1omAzs"
});

// Bot state management (unchanged)
let botState = {
  isFighting: false,
  isRetaliating: false,
  currentTarget: null,
  lastAction: 'Initializing',
  goals: [
    'Gather wood and stone',
    'Create basic tools',
    'Find food',
    'Build shelter',
    'Acquire diamond gear',
    'Find Stronghold',
    'Defeat Ender Dragon',
    'Resummon and defeat Ender Dragon repeatedly'
  ],
  currentGoalIndex: 0,
  karma: 0,
  playerRelations: {}
};

// Global bot reference
let bot;

// Function to create and setup bot (unchanged)
function createAndSetupBot() {
  // Create bot instance
  bot = mineflayer.createBot(config);

  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);

  // Bot event handlers (unchanged)
  bot.on('login', () => {
    console.log(`Logged in as ${bot.username} to ${config.host}:${config.port}`);
    bot.chat('Hello! I am ChatGPT, an AI assistant here to help and explore!');
  });

  bot.on('spawn', () => {
    console.log('Bot spawned in world');
    startAIThinking();
  });

  bot.on('error', (err) => {
    console.log('Error:', err.message);
  });

  bot.on('end', () => {
    console.log('Disconnected from server');
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      createAndSetupBot();
    }, 5000);
  });

  // Player interaction handlers (unchanged)
  bot.on('playerJoined', (player) => {
    console.log(`${player.username} joined the game`);
    botState.playerRelations[player.username] = 0;
    bot.chat(`Hello ${player.username}! I'm ChatGPT, here to help.`);
  });

  bot.on('playerLeft', (player) => {
    console.log(`${player.username} left the game`);
  });

  // Chat handler (unchanged)
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    
    console.log(`${username} said: ${message}`);
    
    if (message.toLowerCase().includes('chatgpt') || message.toLowerCase().includes('ai')) {
      respondToChat(username, message);
    }
    
    if (message.toLowerCase().includes('thank') || message.toLowerCase().includes('help')) {
      botState.playerRelations[username] = (botState.playerRelations[username] || 0) + 1;
    } else if (message.toLowerCase().includes('hate') || message.toLowerCase().includes('stupid')) {
      botState.playerRelations[username] = (botState.playerRelations[username] || 0) - 1;
    }
  });

  // Combat event handlers - Retaliate against both players and hostile mobs
  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) {
      console.log('I was hurt!');
      
      // Find nearby entities and check what hurt us
      const nearbyEntities = Object.values(bot.entities)
        .filter(e => e.position && e.position.distanceTo(bot.entity.position) < 5);
      
      console.log('Nearby entities when hurt:', nearbyEntities.map(e => `${e.type || e.name} (${e.username || 'no username'})`));
      
      // Check for player attacker first
      const playerAttacker = nearbyEntities.find(e => 
        e.type === 'player' && 
        e.username && 
        e.username !== bot.username &&
        bot.players[e.username] // Make sure it's a real player
      );
      
      if (playerAttacker && playerAttacker.username) {
        console.log(`Attacked by player: ${playerAttacker.username} - Retaliating!`);
        botState.playerRelations[playerAttacker.username] = (botState.playerRelations[playerAttacker.username] || 0) - 5;
        retaliate(playerAttacker);
      } else {
        // Check for hostile mobs to attack
        const hostileMob = nearbyEntities.find(e => 
          (e.type === 'hostile' || e.type === 'mob' || e.name?.includes('zombie') || 
           e.name?.includes('skeleton') || e.name?.includes('spider') || 
           e.name?.includes('creeper') || e.name?.includes('enderman')) &&
          e.username !== bot.username
        );
        
        if (hostileMob) {
          console.log(`Attacked by hostile mob: ${hostileMob.name || hostileMob.type} - Fighting back!`);
          retaliate(hostileMob);
        } else {
          console.log('Hurt by unknown entity - No clear target to retaliate against');
        }
      }
    }
  });

  bot.on('death', () => {
    console.log('I died! Respawning...');
    botState.isFighting = false;
    botState.isRetaliating = false;
    botState.currentTarget = null;
  });
}

// Initialize the bot
createAndSetupBot();

// Combat functions with better weapon selection
function retaliate(entity) {
  if (botState.isRetaliating) return;
  
  botState.isRetaliating = true;
  botState.currentTarget = entity;
  
  console.log(`Retaliating against ${entity.username || entity.name}`);
  bot.chat(`Self-defense protocols activated!`);
  
  // Equip best weapon for combat
  const inventory = bot.inventory.items();
  const sword = inventory.find(item => item.name.includes('sword'));
  const axe = inventory.find(item => item.name.includes('axe'));
  
  if (sword) {
    console.log(`Equipping ${sword.name} for combat`);
    bot.equip(sword, 'hand', () => {});
  } else if (axe) {
    console.log(`Equipping ${axe.name} for combat`);
    bot.equip(axe, 'hand', () => {});
  }
  
  const combatInterval = setInterval(() => {
    if (!entity.isValid || entity.health <= 0 || !botState.isRetaliating) {
      clearInterval(combatInterval);
      botState.isRetaliating = false;
      botState.currentTarget = null;
      console.log('Combat ended');
      return;
    }
    
    bot.lookAt(entity.position.offset(0, entity.height, 0));
    
    const angle = Math.atan2(entity.position.z - bot.entity.position.z, 
                            entity.position.x - bot.entity.position.x);
    const strafeAngle = angle + Math.PI / 2;
    const strafeX = Math.cos(strafeAngle) * 2;
    const strafeZ = Math.sin(strafeAngle) * 2;
    
    bot.setControlState('forward', true);
    bot.setControlState('left', strafeX > 0);
    bot.setControlState('right', strafeX < 0);
    
    if (bot.entity.onGround) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 250);
    }
    
    bot.attack(entity);
    
  }, 250);
}

// Auto equip best tool for mining
function equipBestTool(blockType, parameter) {
  const inventory = bot.inventory.items();
  let bestTool = null;
  
  if (parameter === 'wood' || blockType.includes('log')) {
    // Look for axe for wood mining
    bestTool = inventory.find(item => item.name.includes('axe'));
    if (bestTool) {
      console.log(`Equipping ${bestTool.name} for wood mining`);
      bot.equip(bestTool, 'hand');
      return;
    }
  } else if (parameter === 'stone' || blockType.includes('stone')) {
    // Look for pickaxe for stone mining
    bestTool = inventory.find(item => item.name.includes('pickaxe'));
    if (bestTool) {
      console.log(`Equipping ${bestTool.name} for stone mining`);
      bot.equip(bestTool, 'hand');
      return;
    }
  }
  
  // No specific tool found, use hand
  if (bot.heldItem && (bot.heldItem.name.includes('sword') || bot.heldItem.name.includes('pickaxe'))) {
    bot.unequip('hand');
  }
}

// Auto equip armor
function equipBestArmor() {
  const inventory = bot.inventory.items();
  
  // Helmet
  if (!bot.inventory.slots[5]) { // Helmet slot
    const helmet = inventory.find(item => item.name.includes('helmet'));
    if (helmet) {
      console.log(`Equipping ${helmet.name}`);
      bot.equip(helmet, 'head');
    }
  }
  
  // Chestplate
  if (!bot.inventory.slots[6]) { // Chestplate slot
    const chestplate = inventory.find(item => item.name.includes('chestplate'));
    if (chestplate) {
      console.log(`Equipping ${chestplate.name}`);
      bot.equip(chestplate, 'torso');
    }
  }
  
  // Leggings
  if (!bot.inventory.slots[7]) { // Leggings slot
    const leggings = inventory.find(item => item.name.includes('leggings'));
    if (leggings) {
      console.log(`Equipping ${leggings.name}`);
      bot.equip(leggings, 'legs');
    }
  }
  
  // Boots
  if (!bot.inventory.slots[8]) { // Boots slot
    const boots = inventory.find(item => item.name.includes('boots'));
    if (boots) {
      console.log(`Equipping ${boots.name}`);
      bot.equip(boots, 'feet');
    }
  }
}

// Helper function to attempt mining
function attemptMining(blockType, parameter) {
  // Stop any current activities
  bot.clearControlStates();
  
  // Look at the block
  bot.lookAt(blockType.position.offset(0.5, 0.5, 0.5));
  console.log(`Attempting to mine ${blockType.name} at ${blockType.position.x}, ${blockType.position.y}, ${blockType.position.z}`);
  
  // Equip best tool for mining
  equipBestTool(blockType.name, parameter);
  
  bot.dig(blockType, 'ignore').then(() => {
    console.log(`Successfully mined ${blockType.name} (${parameter})`);
    
    // Immediately look for dropped items after mining
    setTimeout(() => {
      const droppedItems = Object.values(bot.entities).filter(entity => 
        entity.kind === 'Drops' && 
        entity.position &&
        entity.position.distanceTo(bot.entity.position) < 5
      );
      
      if (droppedItems.length > 0) {
        console.log(`Collecting ${droppedItems.length} items dropped from mining`);
        const closestItem = droppedItems[0];
        bot.lookAt(closestItem.position);
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 300);
      }
    }, 100);
    
  }).catch((err) => {
    console.log(`Failed to mine ${blockType.name}: ${err.message}`);
    if (err.message.includes('aborted')) {
      console.log('Mining was interrupted, trying to find another block...');
    }
  });
}

// AI Decision Making with Gemini API
async function getAIDecision(worldState) {
  const prompt = `
  You are ChatGPT, an AI Minecraft player in survival mode. Your goals in order are:
  ${botState.goals.join('\n  ')}

  Current world state:
  ${worldState}

  Your current goal: ${botState.goals[botState.currentGoalIndex]}
  Your karma: ${botState.karma}

  Player relationships:
  ${Object.entries(botState.playerRelations).map(([name, value]) => `${name}: ${value}`).join('\n  ')}

  Important rules:
  1. Never initiate combat with players
  2. Only retaliate when attacked
  3. Be helpful to other players when possible
  4. Focus on survival and progression

  Available actions:
  - mine <block_type>
  - craft <item_name>
  - explore <direction>
  - find food
  - build shelter
  - equip <item>
  - attack <mob_type> (only hostile mobs)
  - go to <x> <y> <z>

  Respond with ONLY a JSON object containing:
  {
    "action": "specific action command",
    "reason": "brief explanation of why this action",
    "goalProgress": "how this action moves you toward your current goal"
  }
  `;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash", // or "gemini-2.0-flash" depending on availability
      contents: prompt,
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7
      }
    });

    let decisionText = response.text.trim();
    
    // Strip markdown code block formatting if present
    if (decisionText.startsWith('```json')) {
      decisionText = decisionText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (decisionText.startsWith('```')) {
      decisionText = decisionText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    return JSON.parse(decisionText);
  } catch (error) {
    console.error('Error getting AI decision from Gemini:', error);
    return {
      action: "explore north",
      reason: "Error getting AI decision, defaulting to exploration",
      goalProgress: "Exploring to gather information about the world"
    };
  }
}

// Simple chat response function without API
async function respondToChat(username, message) {
  if (username === bot.username) return;
  
  // Simple contextual responses
  const msg = message.toLowerCase();
  let response = "";
  
  if (msg.includes('hello') || msg.includes('hi')) {
    response = `Hello ${username}! I'm ChatGPT bot, gathering resources!`;
  } else if (msg.includes('help')) {
    response = "I'm just a survival bot, mining wood and stone!";
  } else if (msg.includes('what') && (msg.includes('doing') || msg.includes('up'))) {
    response = "Currently mining resources and exploring!";
  } else if (msg.includes('good') || msg.includes('nice')) {
    response = "Thanks! You too!";
  } else if (msg.includes('food') || msg.includes('hungry')) {
    response = "I eat when I'm hungry, gotta survive!";
  } else {
    // Random friendly responses
    const responses = [
      "Hello!", "Hi there!", "Cool!", "Nice!", "Thanks!",
      "I'm busy mining!", "Survival mode!", "Gathering resources!",
      "Building and surviving!", "Good to see you!"
    ];
    response = responses[Math.floor(Math.random() * responses.length)];
  }
  
  bot.chat(response);
}

// executeAction function (unchanged)
function executeAction(action) {
  const actionParts = action.split(' ');
  const command = actionParts[0].toLowerCase();
  const parameter = actionParts.slice(1).join(' ');

  console.log(`Executing action: ${action}`);

  switch (command) {
    case 'mine':
      let blockMatchFunction;
      const param = parameter.toLowerCase();
      
      // Define better search patterns for common materials
      if (param === 'wood' || param === 'log') {
        blockMatchFunction = block => block.name.includes('_log') || block.name.includes('wood');
      } else if (param === 'stone') {
        blockMatchFunction = block => block.name === 'stone' || block.name === 'cobblestone';
      } else if (param === 'coal') {
        blockMatchFunction = block => block.name === 'coal_ore' || block.name === 'coal_block';
      } else if (param === 'iron') {
        blockMatchFunction = block => block.name === 'iron_ore' || block.name === 'iron_block';
      } else {
        blockMatchFunction = block => block.name.includes(param);
      }
      
      const blockType = bot.findBlock({
        matching: blockMatchFunction,
        maxDistance: 32
      });
      
      if (blockType) {
        console.log(`Found ${blockType.name} at ${blockType.position.x}, ${blockType.position.y}, ${blockType.position.z}`);
        
        // Check if we're close enough to mine
        const distance = bot.entity.position.distanceTo(blockType.position);
        if (distance > 4.5) {
          console.log(`Moving closer to block (distance: ${distance.toFixed(1)})`);
          // Move closer to the block first
          const target = blockType.position.offset(0.5, 0, 0.5);
          bot.lookAt(target);
          bot.setControlState('forward', true);
          
          setTimeout(() => {
            bot.setControlState('forward', false);
            // Try mining after moving closer
            setTimeout(() => {
              attemptMining(blockType, parameter);
            }, 500);
          }, 2000);
        } else {
          attemptMining(blockType, parameter);
        }
      } else {
        console.log(`No ${parameter} found nearby, will explore to find some`);
        // If we can't find the resource, automatically explore to find it
        setTimeout(() => {
          console.log('Auto-exploring to find resources...');
          bot.setControlState('forward', true);
          setTimeout(() => {
            bot.setControlState('forward', false);
            // Turn randomly to explore different areas
            bot.look(Math.random() * 2 * Math.PI, 0);
          }, 6000);
        }, 1000);
      }
      break;

    case 'explore':
      let direction = parameter || 'random';
      let x = bot.entity.position.x;
      let z = bot.entity.position.z;
      
      if (direction === 'north') z -= 30;
      else if (direction === 'south') z += 30;
      else if (direction === 'east') x += 30;
      else if (direction === 'west') x -= 30;
      else {
        x += Math.random() * 60 - 30;
        z += Math.random() * 60 - 30;
      }
      
      console.log(`Exploring towards ${direction}, moving to ${x.toFixed(1)}, ${z.toFixed(1)}`);
      
      // Look in the direction we're going
      bot.lookAt(bot.entity.position.offset(x - bot.entity.position.x, 0, z - bot.entity.position.z));
      bot.setControlState('forward', true);
      bot.setControlState('jump', true); // Enable jumping to overcome obstacles
      
      // Move for longer to cover more ground with intelligent navigation
      let moveInterval = setInterval(() => {
        // Check if there's a block in front and jump if needed
        const frontBlock = bot.blockAt(bot.entity.position.offset(Math.cos(bot.entity.yaw), 0, Math.sin(bot.entity.yaw)));
        if (frontBlock && frontBlock.type !== 0) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 250);
        }
        
        // Look around while moving to spot resources
        if (Math.random() < 0.3) {
          bot.look(bot.entity.yaw + (Math.random() - 0.5) * Math.PI/2, 0);
        }
      }, 1000);
      
      setTimeout(() => {
        clearInterval(moveInterval);
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        console.log('Finished exploring, looking around for resources...');
        
        // Look around 360 degrees after exploring
        let lookCount = 0;
        const lookInterval = setInterval(() => {
          bot.look(bot.entity.yaw + Math.PI/2, 0);
          lookCount++;
          if (lookCount >= 4) {
            clearInterval(lookInterval);
          }
        }, 500);
      }, 8000);
      break;

    case 'find':
      if (parameter === 'food') {
        const foodItems = ['apple', 'bread', 'cooked', 'potato', 'carrot'];
        const food = bot.inventory.items().find(item => 
          foodItems.some(food => item.name.includes(food)));
        if (food) {
          bot.equip(food, 'hand', () => {
            bot.consume(() => {
              console.log('Ate food');
            });
          });
        } else {
          console.log('No food found in inventory');
        }
      }
      break;

    case 'build':
      if (parameter === 'shelter') {
        console.log('Building basic shelter...');
        const wood = bot.inventory.items().find(item => item.name.includes('wood') || item.name.includes('log'));
        if (wood && wood.count >= 8) {
          // Find a suitable ground location
          const pos = bot.entity.position;
          console.log(`Building shelter at ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
          
          // Simple shelter building (4 walls around the bot)
          const shelterPositions = [
            pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
            pos.offset(0, 0, 1), pos.offset(0, 0, -1),
            pos.offset(1, 1, 0), pos.offset(-1, 1, 0),
            pos.offset(0, 1, 1), pos.offset(0, 1, -1)
          ];
          
          // Try to place blocks for shelter
          let blocksPlaced = 0;
          for (const blockPos of shelterPositions) {
            if (blocksPlaced < wood.count && blocksPlaced < 8) {
              setTimeout(() => {
                bot.placeBlock(wood, blockPos).then(() => {
                  console.log(`Placed block at ${blockPos.x}, ${blockPos.y}, ${blockPos.z}`);
                }).catch(err => {
                  console.log(`Could not place block: ${err.message}`);
                });
              }, blocksPlaced * 500);
              blocksPlaced++;
            }
          }
          console.log(`Building shelter with ${blocksPlaced} blocks`);
        } else {
          console.log('Not enough wood to build shelter (need at least 8 wood blocks)');
        }
      }
      break;

    case 'equip':
      const item = bot.inventory.items().find(i => i.name.includes(parameter.toLowerCase()));
      if (item) {
        bot.equip(item, 'hand', () => {
          console.log(`Equipped ${parameter}`);
        });
      }
      break;

    default:
      console.log(`Unknown action: ${action}`);
      bot.setControlState('forward', true);
      setTimeout(() => {
        bot.setControlState('forward', false);
      }, 2000);
  }
}

// getWorldState function (unchanged)
function getWorldState() {
  const { position, health, food } = bot.entity;
  const inventory = bot.inventory.items().map(item => `${item.count} ${item.name}`).join(', ') || 'Empty';
  const nearbyEntities = Object.values(bot.entities)
    .filter(e => e.position && e.position.distanceTo(bot.entity.position) < 10)
    .map(e => e.name || e.type)
    .filter((name, i, arr) => arr.indexOf(name) === i);

  const nearbyPlayers = Object.keys(bot.players)
    .filter(name => name !== bot.username)
    .filter(name => {
      const player = bot.players[name];
      return player && player.entity && player.entity.position.distanceTo(bot.entity.position) < 20;
    });

  return `
Position: ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}
Health: ${health}/20
Food: ${food}/20
Inventory: ${inventory}
Nearby entities: ${nearbyEntities.join(', ') || 'None'}
Nearby players: ${nearbyPlayers.join(', ') || 'None'}
Current goal: ${botState.goals[botState.currentGoalIndex]}
Time: ${bot.time.timeOfDay}
Biome: ${bot.blockAt(bot.entity.position)?.biome?.name || 'Unknown'}
  `.trim();
}

// startAIThinking function (unchanged)
// Auto collect dropped items more aggressively
function collectNearbyItems() {
  const droppedItems = Object.values(bot.entities).filter(entity => 
    entity.kind === 'Drops' && 
    entity.position &&
    entity.position.distanceTo(bot.entity.position) < 12
  );
  
  if (droppedItems.length > 0) {
    console.log(`Found ${droppedItems.length} dropped items nearby, collecting...`);
    // Find closest item
    const closestItem = droppedItems.reduce((closest, item) => {
      const dist = item.position.distanceTo(bot.entity.position);
      return (!closest || dist < closest.distance) ? {item, distance: dist} : closest;
    }, null);
    
    if (closestItem && closestItem.distance < 8) {
      console.log(`Moving to collect item at distance ${closestItem.distance.toFixed(1)}`);
      bot.lookAt(closestItem.item.position);
      
      // Move directly towards the item
      if (closestItem.distance > 1.5) {
        bot.setControlState('forward', true);
        setTimeout(() => {
          bot.setControlState('forward', false);
        }, Math.min(1000, closestItem.distance * 200));
      }
      return true;
    }
  }
  return false;
}

// Auto eat food when hungry
function manageHunger() {
  const food = bot.inventory.items().find(item => 
    ['bread', 'apple', 'carrot', 'potato', 'cooked_beef', 'cooked_porkchop', 
     'cooked_chicken', 'cooked_mutton', 'cooked_fish', 'cooked_salmon',
     'cookie', 'cake', 'pumpkin_pie'].includes(item.name)
  );
  
  if (bot.food <= 15 && food) {
    console.log(`Hungry (${bot.food}/20), eating ${food.name}`);
    bot.equip(food, 'hand').then(() => {
      bot.consume();
    }).catch(err => console.log('Failed to eat:', err.message));
    return true;
  }
  return false;
}

// Simple autonomous decision making without API calls
function makeAutonomousDecision() {
  const inventory = bot.inventory.items();
  // Better wood counting - include all wood types
  const woodCount = inventory.filter(item => 
    item.name.includes('log') || 
    item.name.includes('wood') || 
    item.name.includes('plank')
  ).reduce((a, b) => a + b.count, 0);
  
  const stoneCount = inventory.filter(item => 
    item.name.includes('stone') || 
    item.name.includes('cobblestone')
  ).reduce((a, b) => a + b.count, 0);
  
  console.log(`Current inventory - Wood: ${woodCount}, Stone: ${stoneCount}, Health: ${bot.health}, Food: ${bot.food}`);
  
  // Priority 0: Auto equip armor if available
  equipBestArmor();
  
  // Priority 1: Collect items if any nearby
  if (collectNearbyItems()) {
    return { action: "collect items", reason: "Collecting nearby dropped items" };
  }
  
  // Priority 2: Eat if hungry
  if (manageHunger()) {
    return { action: "eating", reason: "Eating food to restore hunger" };
  }
  
  // Priority 3: Simple goal-based logic
  if (woodCount < 5) {
    // Need more wood
    const woodBlock = bot.findBlock({
      matching: block => block.name.includes('_log') || block.name.includes('wood'),
      maxDistance: 32
    });
    
    if (woodBlock) {
      return { action: "mine wood", reason: "Need wood for crafting" };
    } else {
      return { action: "explore north", reason: "Looking for trees" };
    }
  } else if (stoneCount < 10) {
    // Have wood, need stone
    const stoneBlock = bot.findBlock({
      matching: block => block.name === 'stone' || block.name === 'cobblestone',
      maxDistance: 32
    });
    
    if (stoneBlock) {
      return { action: "mine stone", reason: "Need stone for tools" };
    } else {
      return { action: "explore east", reason: "Looking for stone" };
    }
  } else if (woodCount >= 8) {
    // Have enough materials, build shelter
    return { action: "build shelter", reason: "Have enough materials for shelter" };
  } else {
    // Default exploration
    const directions = ['north', 'south', 'east', 'west'];
    const randomDir = directions[Math.floor(Math.random() * directions.length)];
    return { action: `explore ${randomDir}`, reason: "General exploration" };
  }
}

async function startAIThinking() {
  while (true) {
    if (botState.isRetaliating) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    try {
      const decision = makeAutonomousDecision();
      
      console.log(`Bot Decision: ${decision.action}`);
      console.log(`Reason: ${decision.reason}`);
      
      botState.lastAction = decision.action;
      executeAction(decision.action);
      
    } catch (error) {
      console.error('Error in decision loop:', error);
    }

    // Shorter wait time for more responsive bot
    await new Promise(resolve => setTimeout(resolve, 8000));
  }
}

// Handle process termination (unchanged)
process.on('SIGINT', () => {
  console.log('Disconnecting bot...');
  bot.quit();
  process.exit();
});

console.log('Starting ChatGPT Minecraft Bot with Gemini AI for offline server...');
