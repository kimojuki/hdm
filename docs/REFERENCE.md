# HDM — Référence technique du jeu

> **Document vivant — OBLIGATOIRE** : toute modification importante du projet (gameplay, architecture, assets, constantes, bugs résolus, décisions techniques) doit être reflétée ici **dans la même session**, avant de terminer.
> Dernière mise à jour : 2026-07-02

---

## 1. Vue d'ensemble

**HDM** est un prototype de jeu mobile style *Helldivers 2* en vue 3e personne, construit avec **Three.js** et **Vite**. La phase actuelle sert à tester les assets et les systèmes de base avant le vrai développement gameplay.

| Élément | Valeur |
|---------|--------|
| Dossier projet | `/Users/georges/Desktop/hdm` |
| Stack | Three.js 0.172, Vite 6, ES modules |
| Cible | Navigateur (desktop + mobile tactile) |
| Style visuel | Low-poly / voxel, désert |

### Lancer le projet

```bash
cd hdm
npm install        # première fois
npm run dev        # http://localhost:5173/
```

- **Jeu** : `index.html` → `src/main.js`
- **Admin assets** : `admin.html` → `src/admin/main.js`

Le script `npm run dev` régénère automatiquement le manifeste assets (`npm run assets:manifest`).

---

## 2. Structure des fichiers

```
hdm/
├── assets/                    # Servis à la racine URL via Vite publicDir
│   ├── personnage.fbx
│   ├── solmap1/               # Plantes désert (FBX + texture)
│   ├── environement/montagne/ # Montagnes/collines/plateaux (anneau autour de la map)
│   ├── ennemie/Package/       # Mecha01 (OBJ/MTL voxel)
│   ├── batiment/              # Modèle base personnelle + pack colony (map1)
│   │   └── base.fbx           # Modèle « base » (FBX/GLB/GLTF acceptés)
│   └── guns/                  # AK47 équipé sur le joueur (GLB)
├── docs/
│   └── REFERENCE.md           # ← Ce document
├── scripts/
│   └── build-asset-manifest.mjs
├── src/
│   ├── main.js                # Point d'entrée jeu, connexion → Base personnelle
│   ├── playerBase.js          # Instance Base joueur (hiérarchie, spawn, collisions)
│   ├── playerSession.js       # Session joueur + ID persistant
│   ├── sceneManager.js        # Routage scène (Base / mission)
│   ├── missionMap.js          # Map désert (chargement différé)
│   ├── player.js              # Chargement + animations procédurales joueur
│   ├── weapons.js             # Chargement + attache armes (AK47)
│   ├── enemy.js               # Chargement + placement ennemis
│   ├── controls.js            # Clavier + joystick tactile
│   ├── terrain.js             # Hauteur sol, alignement objets, pentes
│   ├── collisions.js          # Moteur collision hybride (mesh BVH + AABB)
│   └── admin/                 # Outil de prévisualisation assets
├── index.html
├── admin.html
└── vite.config.js             # publicDir → assets/
```

---

## 3. Architecture runtime (jeu)

### 3.1 Initialisation (`main.js`)

**À la connexion**, le joueur apparaît dans **sa Base personnelle** (instance isolée), pas dans le hub désert partagé.

Ordre de chargement :

1. Création session joueur (`PlayerSession` — ID persistant `localStorage`)
2. Chargement modèle `assets/batiment/base` (`.fbx`, `.glb` ou `.gltf`)
3. Montage hiérarchie Base : `Base`, `SpawnPoints`, `InteractiveObjects`, `NPC`, `MissionSelection`, `Equipment`
4. Sol intérieur + collisions mesh BVH précises sur le bâtiment
5. Placement spawn(s) automatique au centre du bâtiment
6. Chargement joueur (`loadPlayer`) au point de spawn
7. Masquage écran de chargement

La **map mission désert** (`missionMap.js` — bâtiments hub, montagnes, plantes, ennemis) est chargée **à la demande** uniquement (éditeur map futur / sélection mission).

### 3.2 Boucle `animate()` (chaque frame)

```
input → saut (si au sol)
     → gravité (velocityY)
     → mouvement horizontal (XZ) + limite pente si au sol
     → clamp limites map
     → snap hauteur pieds (raycast sol)
     → animation joueur
     → caméra 3e personne
     → rotation ennemis + IA patrouille + animation marche
     → render
```

### 3.4 Base personnelle (`playerBase.js`, `playerSession.js`)

| Élément | Détail |
|---------|--------|
| Modèle | `/batiment/base.{fbx,glb,gltf}` ou `/batiment/base/base.*` |
| Instance | Une `PlayerBase` par `playerId` (UUID localStorage) |
| Collisions | BVH mesh complet (pas `steepOnly`) — suit la géométrie visible |
| Spawn | `spawn_main` + 2 alternates, auto depuis bbox du bâtiment |
| Debug | **H** — wireframes collisions (rouge) + marqueurs spawn (vert) |
| Futur | Invitations, sauvegarde décor, équipement via groupes dédiés |

Hiérarchie Three.js :

```
PlayerBase_<playerId>
├── BaseGround
├── Base                 ← modèle 3D
├── SpawnPoints
├── InteractiveObjects   ← vide (futur)
├── NPC                  ← vide (futur)
├── MissionSelection     ← vide (futur)
└── Equipment            ← vide (futur)
```

### 3.5 Constantes gameplay (`main.js`)

| Constante | Valeur | Rôle |
|-----------|--------|------|
| `MAP_SIZE` | 110 | Taille du sol |
| `MAP_HALF` (base) | 48 | Limite XZ dans la Base personnelle |
| `MAP_HALF` (mission) | 68 | Limite XZ map désert (`missionMap.js`) |
| `MOVE_SPEED` | 8 | Vitesse marche (unités/s) |
| `JUMP_SPEED` | 7.5 | Impulsion saut |
| `GRAVITY` | 22 | Gravité |
| `MAX_CLIMB_ANGLE` | π/3.2 (~56°) | Pente max marchable |
| `GROUND_SNAP` | 0.08 | Tolérance pose au sol |
| `CAMERA_OFFSET` | (0, 5, 7) | Caméra derrière joueur |
| `CAMERA_LOOK_OFFSET` | (0, 1.3, 0) | Point visé par la caméra |

---

## 4. Systèmes détaillés

### 4.1 Joueur (`player.js`)

- **Modèle** : `assets/personnage.fbx` (squelette skinné)
- **Hauteur cible** : 1.8 unités monde
- **Animations** : procédurales sur les os (pas de clips FBX)
- **Noms d'os** (sans points) : `thighL`, `upper_armL`, `spine`, etc.
- **États** : idle (respiration) / marche (blend via `walkWeight`)
- **Arme** : AK47 visible sur le personnage ; animations bras = idle/marche standard (pas de pose tir)
- **Pivot** : `fitToGround()` aligne les pieds du modèle sur `y = 0` du groupe joueur

Le groupe `player` positionne les **pieds** en monde ; `player.position.y` = hauteur du sol sous les pieds.

### 4.2 Armes (`weapons.js`)

- **Modèle actuel** : AK47 (`guns/01/Normal version Color and NormalMap/GLB/ak47.glb`)
- **Format** : GLB via `GLTFLoader`
- **Échelle** : longueur cible ~0.82 m (`TARGET_WEAPON_LENGTH`)
- **Attache** : position fixe sur `modelPivot` (n'influence pas les bras)
- **Chargement** : `loadAk47()` → `attachWeaponToPlayer()` ; `equipAk47(player, modelPivot)` dans `loadPlayer()`
- **Animation joueur** : idle / marche d'origine (sans pose arme sur les os)
- **Pas encore** : tir, munitions, changement d'arme, recul

**API** :
- `loadAk47()` — charge le mesh AK47
- `attachWeaponToPlayer(player, weapon, modelPivot)` — attache au pivot joueur
- `equipAk47(player, modelPivot)` — charge + équipe

### 4.3 Contrôles (`controls.js`)

| Entrée | Action |
|--------|--------|
| ZQSD / WASD / Flèches | Déplacement |
| Espace | Saut (file d'attente `consumeJump()`) |
| Joystick tactile (bas gauche) | Déplacement mobile |
| Bouton « Saut » (bas droite) | Saut mobile |

`getMoveVector()` retourne `{ x, y }` normalisé (caméra fixe, Z = avant écran).

### 4.4 Terrain (`terrain.js`)

**Sol procédural** (`createGround` + `analyticalGroundHeight`) :

```js
wave = sin(x * 0.15) * cos(z * 0.12) * 0.4
dune = sin((x + z) * 0.08) * 0.6
hauteur = wave + dune
```

**Fonctions clés :**

| Fonction | Usage |
|----------|--------|
| `sampleTerrainHeight(x, z, roots)` | Raycast depuis y=80 (placement initial) |
| `sampleTerrainHeightAtFeet(x, feetY, z, roots)` | Raycast sous les pieds du joueur |
| `snapObjectBaseToSurface(obj, roots)` | Aligne la bbox mesh la plus basse sur le sol |
| `limitMovementBySlope(...)` | Réduit le déplacement si pente trop forte |
| `isUnderHill(x, z, hills, ground)` | Détecte si une colline est au-dessus (pour placement) |
| `sweepMovementAgainstHills(...)` | Collision parois collines (code prêt, **non utilisé** tant que collines désactivées) |
| `pushOutOfHills(...)` | Anti-enfoncement dans collines (idem) |

**`terrainRoots`** : liste des meshes utilisés pour le raycast pieds du joueur.
Actuellement : `[groundMesh]` uniquement.

### 4.5 Bâtiments / base (`main.js`)

- **Assets** : `assets/batiment/map1/fbx/*.fbx` + texture `T_Spase.png`
- **Layout** : base centrale cohérente via `BUILDING_LAYOUT` (hub, recherche, énergie, sections de liaison)
- **Placement** : `snapObjectBaseToSurface` pour poser chaque bâtiment sur le terrain
- **Collisions** : obstacles statiques activés via `collisionWorld.addStaticFromObject`
- **Rôle gameplay** : crée des couloirs et points de blocage autour du spawn

### 4.6 Décor / plantes

- **20 plantes** disposées via `PLANT_LAYOUT` (FBX `solmap1/Fbx/`)
- **Échelle** : `placement.scale * 0.01` (unités FBX → mètres jeu)
- **Collision** : aucune — le joueur traverse les plantes
- **Placement** : `snapObjectBaseToSurface` sur le sol uniquement (pas sur les collines)

### 4.7 Collines / montagnes

- Assets : `environement/montagne/Fbx/{Hill,Mountain,Plateau}_desert_*.fbx` + texture `T_Mountains_desert.png`
- **Layout** : anneau généré (`buildMountainRingLayout` dans `prefabs.js`) — double mur
  (rayons 64 et 55) + renforts diagonaux, ~70 instances, `unitScale 0.022`
- **Marchables** : ajoutées à `terrainRoots` → le joueur monte les pentes douces
  via raycast (`sampleTerrainHeightAtFeet` + `limitMovementBySlope`)
- **Collision parois** : `addStaticFromObject(obj, { steepOnly: true })` — seuls les
  triangles raides (normale monde `y < WALKABLE_NORMAL_Y = 0.55`, aligné sur
  `MAX_CLIMB_ANGLE`) forment le collider BVH. Les pentes douces et sommets plats
  sont exclus : aucun blocage invisible, les falaises bloquent exactement où le visuel l'exige
- **Anti-chevauchement** : `removeMountainsOverlappingBuildings` retire toute montagne
  dont la bbox touche un bâtiment (padding 10)
- Quand réactivées : penser à `isUnderHill` pour plantes/ennemis + `sweepMovementAgainstHills` pour éviter de traverser les parois en sautant

### 4.8 Ennemis (`enemy.js`)

- **Modèle actuel** : Mecha01 (`ennemie/Package/Mecha01.obj` + `.mtl`)
- **Format** : MagicaVoxel → OBJ/MTL, palette texture `Mecha01.png` (**manquante** dans assets → rendu blanc/gris)
- **Hauteur cible** : 2.2 unités
- **IA** : patrouille autonome autour du point de spawn (rayon 7 m, vitesse 3.2)
- **Orientation** : `MODEL_YAW_OFFSET = -π/2` (mesh MagicaVoxel regarde +X local → avance sur +Z Three.js)
- **Mouvement** : accélération / décélération, rotation lissée (`lerpAngle`), ralentit en virage
- **Animation** : rig `torso` + `legL` + `legR` — jambes en **translation** avant/arrière (+X local) avec léger soulèvement, **sans rotation** (évite la déformation voxel)
- **Sol** : suit le terrain via `sampleTerrainHeightAtFeet` pendant le déplacement
- **Pas encore** : poursuite joueur, dégâts, combat

**Constantes** (`enemy.js`) : `ENEMY_SPEED`, `PATROL_RADIUS`, `ARRIVE_DIST`

**API** :
- `loadMecha01()` — charge le template (cache)
- `initEnemy(enemy, x, z, rot, groundMesh)` — placement + état IA
- `updateEnemy(enemy, dt, terrainRoots, mapHalf)` — mouvement + animation

**Positions actuelles** (`ENEMY_LAYOUT`) :

```js
{ x: 28,  z: -18, rot: Math.PI * 0.8 }
{ x: 34,  z: 10,  rot: Math.PI * 0.65 }
{ x: -30, z: 24,  rot: Math.PI * 1.2 }
```

**Ajouter un ennemi** : étendre `ENEMY_LAYOUT` + `initEnemy` dans `main.js`.

### 4.9 Collisions (`collisions.js`)

**Branché en jeu** via `collisionWorld` dans `main.js`.

| Type | Méthode | Éléments |
|------|---------|----------|
| Statique (mesh) | `addStaticFromObject` | Bâtiments de la base |
| Dynamique (AABB) | `addDynamic` | Ennemis, joueur — recalcul chaque frame |
| **Sans collision** | — | Plantes / petit décor |

**Architecture hybride** :

- `buildMeshCollider(object)` : un collider par bâtiment — géométrie fusionnée en
  espace monde (`StaticGeometryGenerator` de three-mesh-bvh, transformations
  position/rotation/scale intégrées) + `MeshBVH`. **Zéro padding** : la hitbox
  est exactement la surface visible.
- `buildSimpleColliderFromObject` : une AABB globale (entités mobiles simples)
- Broad-phase : test bbox du collider avant toute requête BVH.
- Narrow-phase : capsule joueur approximée par 3 sphères
  (`CAPSULE_SAMPLE_HEIGHTS = [0.3, 0.85, 1.4]`) → `bvh.closestPointToPoint`
  (API three-mesh-bvh 0.9 : retourne `{point, distance, faceIndex}`) →
  repoussement horizontal de `radius - distance`.
- `resolve(excludeObject)` : sous-étapes anti-tunneling (pas max `radius/2`,
  8 max) ; AABB dynamiques puis surfaces mesh statiques exactes à chaque étape.
- `findSafePosition` : spawn — vérifie aussi `isInsideStaticFootprint` (les
  mesh colliders sont creux, la capsule au centre d'un bâtiment ne touche pas
  les murs).
- Rayons : joueur `0.42`, ennemi `ENEMY_COLLISION_RADIUS = 0.48`

**Règle :** plantes traversables ; bâtiments + ennemis bloquants.

**Bug historique (cause des traversées)** : `closestPointToPoint` était appelé
avec l'ancienne signature (target `Vector3`, retour distance). Depuis
three-mesh-bvh 0.5+, le retour est un objet `{point, distance}` — l'ancien code
comparait un objet à un nombre, toutes les collisions mesh étaient silencieusement
ignorées.

**Debug hitboxes** : wireframe rouge des colliders mesh exacts
(`collisionWorld.createDebugGroup`), toggle en jeu avec la touche **H**,
état initial via `SHOW_COLLISION_DEBUG` (`main.js`).

**Test hors navigateur** : `node scripts/test-collisions.mjs` — charge de vrais
FBX bâtiments et vérifie : bbox collider = bbox visuelle, pas de padding,
pas de pénétration en marche/sprint, spawn sûr.

### 4.10 Caméra (`cameraController.js`)

- **Orbite 3e personne** : yaw + pitch + distance autour du joueur
- **Mobile (priorité)** : glisser à droite de l'écran pour tourner ; pincement 2 doigts pour zoom
- **Desktop** : glisser souris sur le canvas ; molette pour zoom
- **Déplacement caméra-relative** : joystick/clavier alignés sur la direction de la vue (`getCameraRelativeMove`)
- Limites : distance 4.5–16, pitch clampé
- **Vue par défaut** : distance 10.8, `lookHeight` 1.1, pitch initial 0.58 (vue arrière plus reculée)

### 4.11 Admin assets (`admin.html`)

- Grille par catégorie (personnages, armes, bâtiments, plantes, montagnes, ennemis)
- **Renderer WebGL partagé** (une seule instance) + cache PNG miniatures
- Support FBX, GLB, OBJ/MTL
- Manifeste auto : `scripts/build-asset-manifest.mjs` → `src/admin/asset-manifest.json`

---

## 5. Assets — conventions

### 5.1 Chemins URL

Les assets dans `assets/` sont servis à la racine :

```
assets/solmap1/Fbx/Desert_plant_001.fbx  →  /solmap1/Fbx/Desert_plant_001.fbx
assets/ennemie/Package/Mecha01.obj      →  /ennemie/Package/Mecha01.obj
```

### 5.2 Formats

| Type | Format | Échelle typique | Texture |
|------|--------|-----------------|---------|
| Joueur | FBX skinné | fit 1.8 m | embarquée |
| Plantes | FBX | × 0.01 | `T_Desert_plants.png` |
| Collines | FBX | × 0.01 | `T_Mountains_desert.png` |
| Ennemis voxel | OBJ + MTL | fit 2.2 m | palette `.png` même dossier |
| Armes | GLB | — | — |
| Bâtiments | FBX | — | `T_Spase.png` |

### 5.3 Ennemis disponibles (non tous en jeu)

| Package | Modèle |
|---------|--------|
| Package | Mecha01 ← **en jeu** |
| Package 2 | MechaGolem |
| Package 3 | Arachnoid |
| Package 4 | Companion-bot |
| Package 5 | FieldFighter |
| Package 6 | MechaTrooper |
| Package 7 | MobileStorageBot |
| Package 8 | QuadrupedTank |
| Package 9 | ReconBot |

### 5.4 Placement au sol — règle obligatoire

Ne **jamais** placer un objet décoratif à `y = 0` sans snap.

```js
object.position.set(x, 0, z);
snapObjectBaseToSurface(object, [groundMesh]);
```

Utilise la **bbox des meshes visibles** (pas les nœuds vides FBX/OBJ).

---

## 6. Journal des modifications

| Date | Modification |
|------|--------------|
| 2026-06 | Création prototype : map 60×60, sol, plantes, personnage FBX |
| 2026-06 | Animations procédurales idle/marche (fix noms os sans points) |
| 2026-06 | Caméra 3e personne, contrôles ZQSD + joystick |
| 2026-06 | Admin assets : renderer partagé, manifeste auto, support OBJ |
| 2026-06 | Collisions AABB debug (rouge) — puis retirées du rendu |
| 2026-06 | Saut + gravité ; collines marchables par raycast |
| 2026-06 | Plantes sans collision ; alignement sol corrigé (bbox mesh) |
| 2026-06 | Collision parois collines (anti-traversée en saut) |
| 2026-06 | Collines **retirées** temporairement du jeu |
| 2026-06 | Ennemi Mecha01 ajouté (3 instances, regarde le joueur) |
| 2026-06 | Création de ce document `docs/REFERENCE.md` |
| 2026-06 | Règle obligatoire : mise à jour doc + règle Cursor `hdm-reference.mdc` |
| 2026-06 | Mecha01 : patrouille autonome + animation marche procédurale (`animPivot`) |
| 2026-06 | Mecha01 : marche jambes par translation (plus de rotation qui déformait le voxel) |
| 2026-06 | Collisions ennemis + joueur (`CollisionWorld` dynamique) ; plantes sans collision |
| 2026-06 | Caméra orbitale mobile/desktop + déplacement relatif à la vue |
| 2026-06 | Fix orientation déplacement caméra-relative (forward/strafe corrigés) |
| 2026-06 | AK47 équipée sur le joueur (`weapons.js`) + pose bras tenue d'arme |
| 2026-06 | Pose deux mains Helldivers (`RIFLE_STANCE` + affinage IK léger des bras) |
| 2026-07 | Map agrandie à 110×110 + base bâtiments connectés + collisions statiques |
| 2026-07 | Végétation redistribuée en couronne extérieure + ennemis repositionnés |
| 2026-07 | Hitboxes bâtiments resserrées (bbox géométrie mesh, pas bbox descendants) + debug lignes rouges |
| 2026-07 | Collisions bâtiments migrées vers mesh collider BVH précis (marge 0) + wireframe debug |
| 2026-07 | Résolution collision renforcée : multi-échantillons hauteur corps pour bloquer les traversées |
| 2026-07 | Spawn joueur sécurisé hors bâtiments + fallback AABB locales anti-traversée résiduelle |
| 2026-07 | **Refonte moteur collision** : fix API `closestPointToPoint` (cause racine des traversées), 1 collider mesh fusionné par bâtiment (`StaticGeometryGenerator`), zéro padding, capsule 3 sphères, toggle debug touche H, tests Node (`scripts/test-collisions.mjs`) |
| 2026-07 | Map 140×140, relief sol enrichi, anneau montagnes double mur (`buildMountainRingLayout`), éditeur de map in-game (touche E : placer/sélectionner/déplacer/échelle/rotation/suppression + export JSON) |
| 2026-07 | **Collisions montagnes précises** : collider BVH filtré aux triangles raides (`steepOnly`, seuil `WALKABLE_NORMAL_Y = 0.55`) — falaises bloquantes exactement sur le mesh, pentes douces marchables sans blocage invisible ; refresh auto via éditeur ; tests Node dédiés |

---

## 7. Problèmes connus

| Problème | Cause / piste |
|----------|----------------|
| Mecha01 blanc/gris | `Mecha01.png` absent de `assets/ennemie/Package/` |
| Pas de rotation caméra | ~~Résolu~~ — `cameraController.js` |
| Collines désactivées | Retirées pour debug ; code partiel dans `terrain.js` |
| `collisions.js` inutilisé | ~~Résolu~~ — ennemis + joueur branchés |
| Ennemis statiques | ~~Résolu~~ — patrouille + animation marche |
| Pas de combat | Hors scope prototype actuel |

---

## 8. Pistes de développement (non fait)

Cocher / mettre à jour au fur et à mesure :

- [ ] Réactiver collines avec placement + collision parois stable
- [ ] Ajouter texture `Mecha01.png`
- [ ] IA ennemie (poursuite joueur, attaque)
- [x] Arme équipée sur le joueur (AK47 GLB)
- [ ] Tir / munitions / FX (`pew.glb`, `bullet1.glb`, etc.)
- [x] Bâtiments sur la map + collisions `CollisionWorld`
- [ ] HUD vie / munitions
- [ ] Son
- [ ] Optimisation mobile (LOD, réduction draw calls)
- [ ] Éditeur de map (layouts JSON externes)

---

## 9. Conventions de code

1. **Modules ES** — un système par fichier (`player.js`, `enemy.js`, `terrain.js`…)
2. **Pas de framework** — Three.js brut + Vite
3. **Layouts en constantes** en tête de `main.js` (`PLANT_LAYOUT`, `ENEMY_LAYOUT`) — migrer vers JSON si la map grossit
4. **Échelle** : toujours normaliser à une hauteur monde cible (1.8 joueur, 2.2 ennemi)
5. **Textures** : `SRGBColorSpace` ; voxel/pixel art → `NearestFilter`
6. **Ombres** : `castShadow` / `receiveShadow` sur meshes gameplay
7. **Minimiser le scope** — ne pas réintroduire les collines en modifiant autre chose
8. **Mettre à jour `docs/REFERENCE.md`** — obligatoire après chaque changement important (voir section 11)

### Ajouter un nouveau type d'entité

1. Créer `src/<entité>.js` avec `load*` + `update*`
2. Importer dans `main.js`
3. Définir un `*_LAYOUT` pour les positions
4. Placer avec `snapObjectBaseToSurface` ou `placeEnemyOnGround`
5. Brancher dans `animate()`
6. Documenter ici (section 4 + journal section 6)

---

## 10. Référence rapide des imports (`main.js`)

```js
import { loadPlayer, updatePlayerAnimation } from './player.js';
import { InputManager } from './controls.js';
import { sampleTerrainHeightAtFeet, limitMovementBySlope, snapObjectBaseToSurface } from './terrain.js';
import { CollisionWorld } from './collisions.js';
import { loadMecha01, initEnemy, updateEnemy, ENEMY_COLLISION_RADIUS } from './enemy.js';
// import { CollisionWorld } from './collisions.js';  // quand obstacles solides
```

---

## 11. Règle de maintenance du document

**Qui** : tout développeur ou agent IA travaillant sur HDM.

**Quand mettre à jour** (au minimum) :

- Nouveau système ou module (`src/*.js`)
- Changement gameplay (mouvement, saut, collision, IA, spawn…)
- Ajout / retrait d'assets en jeu
- Modification des constantes (`MAP_SIZE`, vitesses, layouts…)
- Correction de bug notable (cause + solution en section 7)
- Décision d'architecture (ex. « collines désactivées »)
- Nouvel item sur la roadmap ou item terminé (section 8)

**Quoi mettre à jour** :

| Section | Contenu |
|---------|---------|
| §4 Systèmes | Comportement actuel du code |
| §6 Journal | Ligne datée résumant le changement |
| §7 Problèmes connus | Ajouter / retirer les bugs |
| §8 Roadmap | Cocher ou ajouter les tâches |
| En-tête | Date `Dernière mise à jour` |

**Ce qu'on peut ignorer** : typos, reformattage, changements purement cosmétiques sans impact technique.

---

*Pour toute session de développement (humain ou agent IA) : lire ce fichier en premier, modifier le code, puis mettre à jour les sections concernées avant de conclure.*
