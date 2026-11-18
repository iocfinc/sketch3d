# SKETCH3D — 8-Model Capability Stress Test & Step-by-Step Build Guides

Testing **SKETCH3D** against 8 real-world 3D-printed hardware and organizer models shows where our current 2.5D/multi-part toolset shines today—and the exact 3 features needed to unlock 100% of enclosed electronics cases and pegboards.

---

## 1. Capability Scorecard (All 8 Reference Models)

| Model | Buildable Today? | How It Maps to SKETCH3D | What Blocks Full Completion |
| :--- | :--- | :--- | :--- |
| **Flat-Pack Enclosure Panels** (`IMG_0724`) | **Yes (95%)** | `Rect` + `Round` + `Cutout` (fan/ports) + `M3` holes | Micro-vent perforation grid (needs **Grid Array**) |
| **Modular EDC Wallet Plates** (`IMG_0287`) | **Yes (100%)** | `Poly` thumb-notch + `Round` + `M3` holes + `Extrude Z` | None (fully buildable flat-pack) |
| **Modular Truss Panels** (`IMG_0910`) | **Yes (90%)** | `Rect` + angular `Cutout` triangles + `M3` corner holes | Curved corner joiners need side-plane sketching |
| **Skadis Tool Tote** (`IMG_0250`) | **Partial (70%)** | Base tray (`Rect` + `Round` + `Shell`) & side triangles | Pegboard slot array needs **Linear/Grid Array** |
| **6-Key Macropad** (`IMG_0274`) | **Partial (60%)** | Rounded outer frame + backplate + `Extrude Z` | `3×2` switch cutouts need **Grid Array** & **Blind Pocket** |
| **Heltec LoRa Case** (`IMG_0273`) | **Partial (50%)** | Outer silhouette (`Poly`) + `Shell` + `M3` holes | Recessed `BL-5C` battery bay needs **Blind Pocket** |
| **RAK4630 Case** (`IMG_0272`) | **Partial (45%)** | Stepped outer contour + `Shell` (`3.2 mm` wall) | Internal PCB standoffs + side SMA/USB port cutouts |
| **Hex Skadis Organizer** (`IMG_0249`) | **Partial (50%)** | Hex base (`Shapes ▾ → Hexagon` + `Shell`) | Vertical face pegboard slots need **Side-Face Array** |

---

## 2. Step-by-Step User Guides (Ready for Marketing & Onboarding)

### Guide 1: Modular EDC Wallet Plate (`IMG_0287`) — *Beginner (2 mins)*
1. Tap **Clear All**, then **Shapes ▾ → ▭ Rectangle** and drag a `88 × 56 mm` card plate.
2. Drag the **Round** slider to **`4 mm`** for pocket-friendly rounded corners.
3. Switch to **✥ Edit** and tap **Shapes ▾ → ▭ + Cutout** to punch a thumb-slide notch on the top edge (tap **Close** to finish the cutout).
4. Switch to **Shapes ▾ → ⊙ + M3 Hole** and drop 4 mounting holes in the corners.
5. Set **Extrude Z** to **`3 mm`**, **Bevel** to **`0.5 mm`**, and tap **⬇ Export .STL** to print two plates flat on your Bambu Lab A1.

### Guide 2: Flat-Pack Electronics Panel (`IMG_0724`) — *Intermediate (3 mins)*
1. Tap **Shapes ▾ → ▭ Rectangle** and drag a `120 × 90 mm` plate; set **Round** to **`3 mm`**.
2. Switch to **⬠ Poly** (or **✥ Edit**) to add mounting tabs along the left/right edges (`90° Ortho` keeps tabs square).
3. Tap **Shapes ▾ → ▭ + Cutout** to punch rectangular screen/port openings, or drop a centered circular fan cutout (`32`-pt `Circle`).
4. Drop **M3** holes on each mounting tab, set **Extrude Z** to **`3 mm`**, and export `.STL`.

### Guide 3: Tool Tote Base Tray & Side A-Frames (`IMG_0250`) — *Intermediate (4 mins)*
1. **Tray (`Part 1`):** Drag a `180 × 110 mm` **Rectangle**, set **Round** to **`10 mm`**, toggle **Shell: On** (`2.8 mm` wall), and set **Extrude Z** to **`24 mm`**.
2. **Side Frame (`Part 2`):** Open **Parts ▾ → + New Side Part**, switch to **⬠ Poly**, and tap a `100 × 130 mm` triangle (`90° Ortho` snaps the base flat). Set **Extrude Z** to **`5 mm`**.
3. Export `.STL` and duplicate the side frame once in Bambu Studio.

---

## 3. Top 3 Features Surfaced for Sprint 3
1. **Grid / Linear Array (`Repeat X × Y`):** Essential for Skadis pegboard slots (`IMG_0250`), macropad switch matrices (`IMG_0274`), and cooling vents (`IMG_0724`).
2. **Blind Pocket (`Pocket Depth mm`) & Side-Wall Cutouts:** Needed for recessed battery bays (`IMG_0273`), PCB cavities (`IMG_0274`), and side USB/SMA ports (`IMG_0272`).
3. **Free-Place Internal Standoffs:** Allow dropping cylindrical `M3` bosses at `(X, Y)` inside a `Shell` housing without shrinking `Part 1`.
