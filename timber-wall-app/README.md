# Timber Wall Frame Builder — Step A

A real parametric model, not a lookup form: you specify wall size, framing
material, cross-sections, and stud count; the app computes actual stud/beam
positions, renders them in 3D, and derives — rather than looks up — the
tolerance envelope for length, height, diagonal, and squareness.

## Run it
```bash
cd timber-wall-app
pip install flask
python app.py
```
Open http://127.0.0.1:5001

## What changed vs. the first prototype
- **Real geometry**, not an abstract two-component picker: stud positions
  are computed from wall length + stud count + stud cross-section width.
- **cm for the wall, mm for cross-sections/tolerances** — no more ambiguous
  mixed units.
- **Squareness/perpendicularity is actually derived**, not selected from a
  dropdown (see Methodology below).
- **3D view** (three.js) with tolerance-relevant dimensions overlaid
  (length, height, diagonal, squareness pass/fail), styled after your
  reference images — plain wood tone frame, orange overlay for tolerance
  callouts.
- **Three tolerance-performance graphs** (Chart.js), described below.

## Methodology — why the numbers come out the way they do

**A frame built from nominal dimensions is always perfectly square.**
There is no "deviation" to display unless you model the *tolerance range*
of the components, not just their target values. So the pipeline is:

1. **Component-level tolerance** — the wall's overall length is treated as
   governed by the top/bottom beam as one continuous member (its own
   length tolerance, from EN 336/DIN 4074/EN 14080 depending on
   material). The wall's height is governed by the stud, the same way.
2. **Assembly-level tolerance** — DIN 18202's "dimensions in plan" (for
   length) and "dimensions in elevation" (for height) add an independent
   allowance for the *assembled* wall, on top of a perfect component.
3. **Combination** — both worst-case (sum of magnitudes) and RSS
   (root-sum-square, assuming independence) are computed side by side.
4. **Diagonal** is *derived*, not looked up, via linearized error
   propagation: for D = √(L²+H²), ∂D/∂L = L/D and ∂D/∂H = H/D, so
   ΔD(RSS) = √((L/D·ΔL)² + (H/D·ΔH)²). This is the standard first-order
   approach for propagating independent tolerances through a nonlinear
   derived quantity, valid because ΔL, ΔH ≪ L, H here.
5. **Squareness limit** — modeled as the DIN 18202 *angular* deviation
   value evaluated at the wall's diagonal length. DIN 18202 doesn't
   publish a dedicated frame-squareness rate table the way panel standards
   do (e.g. OSB's 2.0 mm/m in EN 300) — **this is the single modeling
   choice most worth scrutinizing/defending in your thesis.** An
   alternative: adopt a panel-style mm/m rate directly instead.
6. **Stud positional tolerance** (Chart 3) compares two fabrication
   philosophies: datum-referenced (jig/laser line — constant tolerance per
   stud, taken as DIN 18202's column alignment deviation) vs. chained
   (stud-to-stud tape measurement — tolerance accumulates linearly with
   stud index). This is a genuinely useful, real result: it demonstrates
   quantitatively why jig-based fabrication matters.

All of these are labeled `A1`–`A6` as comments at the top of `geometry.py`
— cite them as explicit assumptions in your methods chapter rather than
implicit code behavior.

## The three tolerance-performance graphs

1. **Deviation budget by source** — for the current wall, how much of the
   combined tolerance comes from the material vs. the DIN 18202 assembly
   allowance, for length/height/diagonal. Good for explaining *why* a
   number is what it is.
2. **Permitted deviation vs. target size** — DIN 18202's step-function
   bands and the material's length tolerance, plotted against target size
   from 0.5–30 m, with your current wall's size marked. Shows how
   compliance risk changes as you scale the design up.
3. **Stud positional tolerance accumulation** — datum-referenced vs.
   chained fabrication, as described above.

## Data quality — what's still flagged
Re-checked against your updated PDFs, several values are corrected and
several `verified: false` flags were resolved (e.g. KVH width/thickness
bands are now confirmed consistent). Remaining unresolved items (KVH's own
length tolerance isn't in the source table at all; sheeting moisture
content/warping row assignments are still ambiguous) are listed with notes
in `data/materials.json` and will also print in the app's amber "Data
notes" box whenever a computation actually uses one of them.

## Next: Step B (panels on frame) and Step C (assembly vs. DIN 18202)
Per your reframing, both should consume Step A's output as their starting
state rather than being independent forms:
- **B** takes the frame geometry from A, adds a panel material/layout
  input, computes panel-to-frame interface tolerance (panel dimensional
  tolerance stacked against the *as-analyzed* frame from A, not the
  nominal one), and renders the panel over the frame in 3D — following
  your "Final Product" reference image's visual style (solid front face,
  openings cut through).
- **C** takes B's output and checks the finished assembly against a
  DIN 18202 building-class selection (flatness/alignment), the same way
  the very first prototype's DIN-compliance check worked, but now applied
  to the *derived* assembly tolerance from real geometry instead of a
  picked value.

I'd suggest confirming Step A matches what you had in mind (numbers,
overlay style, chart usefulness) before I build B — cheaper to adjust the
frame model now than after panels and openings depend on it.

## Asymmetric limits (assumption A9 / B5)
Where a standard's limit is asymmetric (e.g. EN 336 class 1 width -1/+3 mm,
gypsum Type P width 0/-8 mm), the limit is NOT reduced to one symmetric
number. The plus side and the minus side are each combined with the
DIN 18202 allowance separately and both are reported. The headline value is
the side that gives the larger result (the governing side), so a pass means
that both sides pass. Step C already worked per side. Earlier versions used
the plus value only, which gave 0 for gypsum board.

## Squareness comparison at exactly the limit
A squareness value equal to the DIN 18202 limit passes ("not more than"). The
comparison in geometry.py allows 1e-9 mm of floating-point noise, so a value that
is mathematically 16 mm no longer fails against a 16 mm limit (seen for a 6 m wall
at 3.45 m height, where the RSS diagonal tolerance equals the limit exactly).
