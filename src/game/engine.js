import crypto from "crypto";

// ===== Durak game engine (server-authoritative) =====
// Ported 1:1 from the frontend's lib/multiplayerDurak.ts so that client
// and server always agree on rules. This is the ONLY place game rules
// should live from now on.

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValue = (r) => RANKS.indexOf(r);

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck() {
  return shuffle(
    SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: crypto.randomUUID(), suit, rank })))
  );
}

function sortHand(hand, trump) {
  return [...hand].sort(
    (a, b) =>
      Number(a.suit === trump) - Number(b.suit === trump) ||
      SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) ||
      rankValue(a.rank) - rankValue(b.rank)
  );
}

function lowestTrump(hand, trump) {
  return hand.filter((c) => c.suit === trump).sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0];
}

export function beats(defense, attack, trump) {
  if (defense.suit === attack.suit) return rankValue(defense.rank) > rankValue(attack.rank);
  return defense.suit === trump && attack.suit !== trump;
}

function legalAttack(game, card) {
  if (!game.table.length) return true;
  const ranksOnTable = new Set(game.table.flatMap((p) => [p.attack.rank, p.defense?.rank]).filter(Boolean));
  return ranksOnTable.has(card.rank);
}

function cloneGame(game) {
  return {
    ...game,
    players: game.players.map((p) => ({ ...p })),
    deck: [...game.deck],
    hands: Object.fromEntries(Object.entries(game.hands).map(([k, cards]) => [k, [...cards]])),
    table: game.table.map((p) => ({ ...p })),
  };
}

function drawToSix(game, firstId, secondId) {
  if (!game.trump) return;
  for (const id of [firstId, secondId]) {
    while ((game.hands[id]?.length || 0) < 6 && game.deck.length) {
      game.hands[id].push(game.deck.shift());
    }
    game.hands[id] = sortHand(game.hands[id], game.trump);
  }
}

function checkWinner(game) {
  if (game.deck.length) return;
  const [a, b] = game.players;
  if (!a || !b) return;
  const ah = game.hands[a.id].length;
  const bh = game.hands[b.id].length;
  if (ah === 0 && bh === 0) {
    game.status = "finished";
    game.winnerId = "draw";
    game.message = "Draw";
  } else if (ah === 0) {
    game.status = "finished";
    game.winnerId = a.id;
    game.message = `${a.username} wins`;
  } else if (bh === 0) {
    game.status = "finished";
    game.winnerId = b.id;
    game.message = `${b.username} wins`;
  }
}

export function newOnlineGame(code, players) {
  return {
    code,
    status: "waiting",
    players, // [{id, username}]
    deck: [],
    trump: undefined,
    hands: {},
    table: [],
    attackerId: undefined,
    defenderId: undefined,
    maxAttacks: 6,
    message: "Waiting for opponent",
    winnerId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 0,
  };
}

export function startOnlineGame(game) {
  if (game.players.length !== 2) return game;
  const next = cloneGame(game);
  next.deck = makeDeck();
  next.trump = next.deck[next.deck.length - 1].suit;
  next.hands = {
    [next.players[0].id]: [],
    [next.players[1].id]: [],
  };
  for (let i = 0; i < 6; i++) {
    next.hands[next.players[0].id].push(next.deck.shift());
    next.hands[next.players[1].id].push(next.deck.shift());
  }
  next.hands[next.players[0].id] = sortHand(next.hands[next.players[0].id], next.trump);
  next.hands[next.players[1].id] = sortHand(next.hands[next.players[1].id], next.trump);

  const p1Trump = lowestTrump(next.hands[next.players[0].id], next.trump);
  const p2Trump = lowestTrump(next.hands[next.players[1].id], next.trump);

  let attacker = next.players[0];
  let defender = next.players[1];
  if (p1Trump && p2Trump && rankValue(p2Trump.rank) < rankValue(p1Trump.rank)) {
    attacker = next.players[1];
    defender = next.players[0];
  } else if (!p1Trump && p2Trump) {
    attacker = next.players[1];
    defender = next.players[0];
  }

  next.attackerId = attacker.id;
  next.defenderId = defender.id;
  next.maxAttacks = Math.min(6, next.hands[defender.id].length);
  next.table = [];
  next.status = "active";
  next.message = `${attacker.username} attacks`;
  next.updatedAt = new Date().toISOString();
  next.revision = (next.revision || 0) + 1;
  return next;
}

export function applyOnlineAction(original, userId, action, cardId) {
  const game = cloneGame(original);
  if (game.status !== "active" || !game.trump || !game.attackerId || !game.defenderId) {
    throw new Error("GAME_NOT_ACTIVE");
  }
  if (!game.players.some((p) => p.id === userId)) throw new Error("NOT_IN_GAME");

  const attacker = game.players.find((p) => p.id === game.attackerId);
  const defender = game.players.find((p) => p.id === game.defenderId);

  if (action === "play") {
    if (!cardId) throw new Error("CARD_REQUIRED");
    const hand = game.hands[userId];
    const card = hand.find((c) => c.id === cardId);
    if (!card) throw new Error("CARD_NOT_FOUND");

    if (userId === game.attackerId) {
      if (game.table.some((p) => !p.defense)) throw new Error("WAIT_FOR_DEFENSE");
      if (game.table.length >= game.maxAttacks) throw new Error("ATTACK_LIMIT");
      if (!legalAttack(game, card)) throw new Error("INVALID_ATTACK");
      game.hands[userId] = hand.filter((c) => c.id !== card.id);
      game.table.push({ attack: card });
      game.message = `${defender.username} must defend or take`;
    } else if (userId === game.defenderId) {
      const pair = game.table.find((p) => !p.defense);
      if (!pair) throw new Error("NOTHING_TO_DEFEND");
      if (!beats(card, pair.attack, game.trump)) throw new Error("INVALID_DEFENSE");
      game.hands[userId] = hand.filter((c) => c.id !== card.id);
      pair.defense = card;
      game.message = `${attacker.username} may add a card or finish the round`;
    } else {
      throw new Error("NOT_YOUR_TURN");
    }
  }

  if (action === "done") {
    if (userId !== game.attackerId) throw new Error("ONLY_ATTACKER_CAN_FINISH");
    if (!game.table.length || game.table.some((p) => !p.defense)) throw new Error("ROUND_NOT_READY");

    game.table = [];
    drawToSix(game, game.attackerId, game.defenderId);
    const oldAttacker = game.attackerId;
    game.attackerId = game.defenderId;
    game.defenderId = oldAttacker;
    game.maxAttacks = Math.min(6, game.hands[game.defenderId].length);
    const newAttacker = game.players.find((p) => p.id === game.attackerId);
    game.message = `${newAttacker.username} attacks`;
    checkWinner(game);
  }

  if (action === "take") {
    if (userId !== game.defenderId) throw new Error("ONLY_DEFENDER_CAN_TAKE");
    if (!game.table.some((p) => !p.defense)) throw new Error("NOTHING_TO_TAKE");

    const cards = game.table.flatMap((p) => (p.defense ? [p.attack, p.defense] : [p.attack]));
    game.hands[userId].push(...cards);
    game.hands[userId] = sortHand(game.hands[userId], game.trump);
    game.table = [];
    drawToSix(game, game.attackerId, game.defenderId);
    game.maxAttacks = Math.min(6, game.hands[game.defenderId].length);
    game.message = `${attacker.username} attacks again`;
    checkWinner(game);
  }

  game.updatedAt = new Date().toISOString();
  game.revision = (game.revision || 0) + 1;
  return game;
}

export function publicOnlineState(game, userId) {
  const me = game.players.find((p) => p.id === userId);
  const opponent = game.players.find((p) => p.id !== userId);
  if (!me) throw new Error("NOT_IN_GAME");

  return {
    code: game.code,
    status: game.status,
    me,
    opponent: opponent || null,
    hand: game.hands[userId] || [],
    opponentCardCount: opponent ? game.hands[opponent.id]?.length || 0 : 0,
    deckCount: game.deck.length,
    trump: game.trump || null,
    table: game.table,
    attackerId: game.attackerId || null,
    defenderId: game.defenderId || null,
    maxAttacks: game.maxAttacks,
    message: game.message,
    winnerId: game.winnerId || null,
    updatedAt: game.updatedAt,
    revision: game.revision || 0,
  };
}
