// Comms bus — the one place every callout flows through. Bots (and the player's
// command wheel) push messages here; the bus rate-limits by category and
// speaker, de-dups, then routes accepted lines to a procedural voice bark
// (audio.voice) and the HUD comms feed. Fully offline: lines come from the
// LINES banks in data.js, voices are synthesized, nothing leaves the tab.
import { pickLine, voiceFor } from './data.js';

// Per-category behavior. cd = seconds between messages of this kind; prio =
// importance (>=5 bypasses cooldowns; <=1 is "chatter" thinned by the density
// setting); mood = default voice inflection.
const CAT = {
  command:   { cd: 0,   prio: 5, mood: 'urgent' },
  ack:       { cd: 0.5, prio: 4, mood: 'calm' },
  refuse:    { cd: 0.5, prio: 4, mood: 'calm' },
  need:      { cd: 3,   prio: 4, mood: 'urgent' },
  clutch:    { cd: 6,   prio: 4, mood: 'urgent' },
  objective: { cd: 3,   prio: 3, mood: 'urgent' },
  plan:      { cd: 6,   prio: 3, mood: 'calm' },
  contact:   { cd: 2.5, prio: 2, mood: 'urgent' },
  report:    { cd: 1,   prio: 2, mood: 'calm' },
  revenge:   { cd: 5,   prio: 2, mood: 'taunt' },
  radio:     { cd: 1.5, prio: 2, mood: 'calm' }, // backward-compat raw text
  kill:      { cd: 2.2, prio: 1, mood: 'smug' },
  status:    { cd: 5,   prio: 1, mood: 'hurt' },
  banter:    { cd: 9,   prio: 0, mood: 'calm' },
};

export class Comms {
  constructor(game) {
    this.game = game;
    this.catAt = {};      // category -> next allowed sim time
    this.speakerAt = {};  // speaker.id -> next allowed sim time
    this.recent = [];     // recent texts for de-dup
    this.lastVoiceT = -99;
  }

  // Fresh round: forget cooldowns so the first calls land immediately.
  reset() {
    this.catAt = {};
    this.speakerAt = {};
    this.recent.length = 0;
  }

  // Rich path: pull a line from the bank for `cat`, flavored by the speaker.
  say(speaker, cat, opts = {}) {
    const text = opts.text || pickLine(cat, speaker?.char?.id, opts);
    if (!text) return false;
    return this.emit({ speaker, cat, text, ...opts });
  }

  // Backward-compat raw text path (game.radio passes a finished string).
  raw(speaker, text, opts = {}) {
    return this.emit({ speaker, cat: opts.cat || 'radio', text, ...opts });
  }

  emit(msg) {
    const g = this.game;
    if (g.over || !msg.speaker || !msg.text) return false;
    const sp = msg.speaker;
    const cat = CAT[msg.cat] ? msg.cat : 'radio';
    const def = CAT[cat];
    const t = g.time;
    const s = g.settings || {};
    const chatter = s.chatter ?? 0.7;
    const scope = msg.scope || 'team'; // 'team' = our radio; 'world' = audible barks (enemies too)
    const onMyTeam = sp.team === g.human.team && sp !== g.human;

    // force bypasses all gating — used for direct answers to player commands
    if (!msg.force) {
      // optional caller-supplied chance for rare/flavor lines
      if (msg.chance != null && Math.random() > msg.chance) return false;
      // low-priority chatter is thinned by the density slider
      if (def.prio <= 1 && Math.random() > chatter) return false;
      if (def.prio < 5) {
        if ((this.catAt[cat] || 0) > t) return false;
        if ((this.speakerAt[sp.id] || 0) > t) return false;
      }
      this.recent = this.recent.filter((r) => t - r.t < 4);
      if (this.recent.some((r) => r.text === msg.text)) return false;
    } else {
      this.recent = this.recent.filter((r) => t - r.t < 4);
    }

    // stamp cooldowns (chattier when the density setting is high)
    this.catAt[cat] = t + def.cd / (def.prio >= 3 ? 1 : 0.5 + chatter);
    this.speakerAt[sp.id] = t + 1.0;
    this.recent.push({ text: msg.text, t });

    const mood = msg.mood || def.mood || 'calm';
    const pos = msg.pos || sp.pos || null;
    // we hear our own team's radio anywhere; enemy/world barks only carry by
    // distance (audio.voice spatializes, so far-off taunts fade to nothing)
    const hear = scope === 'team' ? (onMyTeam || sp === g.human) : true;
    if (hear && (s.voiceVolume ?? 0.8) > 0 && this.lastVoiceT !== t) {
      this.lastVoiceT = t;
      g.audio.voice(voiceFor(sp.char?.id), mood, scope === 'team' && onMyTeam ? null : pos, s.voiceVolume ?? 0.8);
    }
    // only our own team's comms appear in the feed
    if (scope === 'team' && onMyTeam && s.subtitles !== false) {
      g.hud.comms(sp.name, msg.text, sp.team);
    }
    return true;
  }
}
