# VRQuests

A browser-based, WebXR VR quest game for Meta Quest 2 and later — in the
style of Rec Room quests. No install, no build step, no server. Open the
page in the Meta Quest Browser and play.

Fan-made game inspired by the quest style of Rec Room.
Not affiliated with Rec Room Inc.

## Play it

**Hosted version (after GitHub Pages is enabled, see below):**

`https://jenochjones.github.io/VRQuests/`

**On Quest 2+:**

1. Open the link above in the Meta Quest Browser.
2. Pick your avatar color, then choose a quest — or walk into a portal
   in the Rec Center.
3. Tap **Enter VR (Quest 2+)**. The page starts in 2D — that's normal.
   After a quest starts, the **Enter VR** button stays in the
   bottom-right corner, so you can switch into VR at any time.
4. Left thumbstick to move, right thumbstick to snap-turn.
   Right trigger = sword swing, left trigger = magic bolt.

**On desktop (for testing):**

Click the scene to capture the mouse, WASD to move, mouse to look,
click = sword, F = magic bolt, H = heal (20 coins), E = use altar.

## The quests

| Quest | Difficulty | Enemies | Boss |
|---|---|---|---|
| Goblin Grotto 🌲 | Easy | Goblins | Goblin King 👑 |
| Skull Isle 🏝️ | Medium | Skeletons | Skeleton Captain 💀 |
| Ember Keep 🌋 | Hard | Fire Imps | Ember Witch 🔥 |

Every quest follows the same loop, Rec Room style:

1. **Collect 5 crystals** (glowing cyan) scattered around the map.
2. **Defeat 6 minions** with your sword or magic bolts.
3. **Touch the altar** near the gate to open it.
4. **Defeat the boss** in the arena beyond the gate — bosses are bigger,
   hit harder, and (in Ember Keep especially) shoot back.

Coins are scattered around each map, hearts heal 25 HP, and getting
knocked out respawns you at the start (costing 10 coins). Finishing a
quest pays 100 bonus coins. The **Rec Center** button returns you to
the hub at any time.

## Party play (up to 4 players)

Duels are peer-to-peer via WebRTC (PeerJS cloud is used only for the
initial introduction; game data travels directly between browsers):

1. One player chooses **Host a Party** and shares the party code.
2. The others choose **Join a Party** and enter it.
3. The host starts a quest from the lobby or a portal — guests follow
   into the same quest, see each other's avatars, and quest together.
   The host runs the enemies and quest progress, so everyone fights
   the same goblins, skeletons, and bosses.

Both headsets must be on a network that allows WebRTC peer connections
(a normal home Wi-Fi setup works; some strict corporate/school
networks block it).

## Files

* `index.html` — lobby, HUD, and page shell.
* `game.js` — the whole game: Three.js + WebXR scene, Rec Center hub,
  the three quests, weapons, enemy and boss AI, pickups, and
  peer-to-peer party play.
* `style.css` — lobby and HUD styling.

## GitHub Pages setup

This repo is static, so Pages can serve it directly:

1. On GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Choose branch `main`, folder `/ (root)` — the site appears at
   `https://jenochjones.github.io/VRQuests/`.

## Local testing

```sh
python3 -m http.server 8000
# open http://localhost:8000/ — use desktop controls, or
# open the same URL from your Quest Browser on the same Wi-Fi network
```

WebXR requires a secure context (https, or `localhost`), which is why
the hosted GitHub Pages URL is the recommended way to play on Quest.

## Known limits

* Enemies are simple chasers with a health bar, not full Rec Room
  dungeon AI — the focus is a complete, playable quest loop in the
  browser with no server.
* In a party, guests see host-driven enemies; if the host leaves,
  the party's enemies stop updating. The host should stay in the quest.
* Quest maps are open arenas with scattered scenery, not hand-built
  multi-room dungeons — a deliberate trade-off to keep the game
  fast on Quest 2.
