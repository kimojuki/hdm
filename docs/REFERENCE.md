# HDM — Référence technique du jeu

> **Document vivant — OBLIGATOIRE** : toute modification importante du projet (gameplay, architecture, assets, constantes, bugs résolus, décisions techniques) doit être reflétée ici **dans la même session**, avant de terminer.
> Dernière mise à jour : 2026-06-26

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
│   ├── environement/montagne/ # Collines (FBX — désactivées en jeu pour l'instant)
│   ├── ennemie/Package/       # Mecha01 (OBJ/MTL voxel)
│   ├── batiment/              # Non utilisé en jeu
│   └── guns/                  # AK47 équipé sur le joueur (GLB)
├── docs/
│   └── REFERENCE.md           # ← Ce document
├── scripts/
│   └── build-asset-manifest.mjs
├── src/
│   ├── main.js                # Point d'entrée jeu, scène, boucle
│   ├── player.js              # Chargement + animations procédurales joueur
│   ├── weapons.js             # Chargement + attache armes (AK47)
│   ├── enemy.js               # Chargement + placement ennemis
│   ├── controls.js            # Clavier + joystick tactile
│   ├── terrain.js             # Hauteur sol, alignement objets, pentes
│   ├── collisions.js          # Système AABB (prêt, non branché en jeu)
│   └── admin/                 # Outil de prévisualisation assets
├── index.html
├── admin.html
└── vite.config.js             # publicDir → assets/
```

---

## 3. Architecture runtime (jeu)

### 3.1 Initialisation (`main.js`)

Ordre de chargement :

1. Création du sol ondulé (`createGround`)
2. Chargement texture plantes + placement `PLANT_LAYOUT`
3. Alignement plantes sur le sol (`snapObjectBaseToSurface`)
4. Spawn ennemis `ENEMY_LAYOUT` (Mecha01)
5. Chargement joueur (`loadPlayer`) au spawn `(0, 0)`
6. Masquage écran de chargement

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

### 3.3 Constantes gameplay (`main.js`)

| Constante | Valeur | Rôle |
|-----------|--------|------|
| `MAP_SIZE` | 60 | Taille du sol |
| `MAP_HALF` | 28 | Limite XZ joueur (`MAP_SIZE/2 - 2`) |
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
- `attachWeaponToPlayer(player, weapon)` — attache au squelette
- `equipAk47(player)` — charge + équipe

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

### 4.5 Décor / plantes

- **20 plantes** disposées via `PLANT_LAYOUT` (FBX `solmap1/Fbx/`)
- **Échelle** : `placement.scale * 0.01` (unités FBX → mètres jeu)
- **Collision** : aucune — le joueur traverse les plantes
- **Placement** : `snapObjectBaseToSurface` sur le sol uniquement (pas sur les collines)

### 4.6 Collines / montagnes

- Assets : `environement/montagne/Fbx/Hill_desert_*.fbx`
- **État actuel : retirées du jeu** (juin 2026) pour simplifier le debug ennemis et éviter les placements sous les meshes
- Le code de chargement (`HILL_LAYOUT`, `loadHills`) a été supprimé de `main.js`
- `terrain.js` conserve les helpers collines pour réactivation future
- Quand réactivées : penser à `isUnderHill` pour plantes/ennemis + `sweepMovementAgainstHills` pour éviter de traverser les parois en sautant

### 4.7 Ennemis (`enemy.js`)

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
{ x: 8,  z: 0,  rot: Math.PI }   // devant le spawn
{ x: 12, z: 2,  rot: Math.PI }
{ x: -6, z: 10, rot: 0.8 }
```

**Ajouter un ennemi** : étendre `ENEMY_LAYOUT` + `initEnemy` dans `main.js`.

### 4.8 Collisions (`collisions.js`)

**Branché en jeu** via `collisionWorld` dans `main.js`.

| Type | Méthode | Éléments |
|------|---------|----------|
| Statique (mesh) | `addStaticFromObject` | Bâtiments, collines (futur) |
| Dynamique (AABB) | `addDynamic` | Ennemis, joueur — recalcul chaque frame |
| **Sans collision** | — | Plantes / petit décor |

- `buildCollidersFromObject` : AABB par mesh (obstacles fixes)
- `buildSimpleColliderFromObject` : une AABB globale (entités mobiles)
- `resolve(excludeObject)` : cercle repoussé des boîtes XZ + filtre hauteur `feetY` (saut au-dessus)
- Rayons : joueur `0.42`, ennemi `ENEMY_COLLISION_RADIUS = 0.48`

**Règle :** plantes et décor traversables ; tout le reste (ennemis, futurs bâtiments) bloque.

### 4.9 Caméra (`cameraController.js`)

- **Orbite 3e personne** : yaw + pitch + distance autour du joueur
- **Mobile (priorité)** : glisser à droite de l'écran pour tourner ; pincement 2 doigts pour zoom
- **Desktop** : glisser souris sur le canvas ; molette pour zoom
- **Déplacement caméra-relative** : joystick/clavier alignés sur la direction de la vue (`getCameraRelativeMove`)
- Limites : distance 4.5–16, pitch clampé

### 4.10 Admin assets (`admin.html`)

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
- [ ] Bâtiments sur la map + collisions `CollisionWorld`
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
