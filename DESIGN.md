---
name: NOISE — Select-O-Matic
description: A browser phonk workstation rendered as a lacquered jukebox cabinet.
colors:
  lacquer: '#0c0a09'
  lacquer-2: '#171311'
  panel: '#151210'
  cream: '#f1e6c8'
  cream-2: '#e4d7b4'
  ink: '#1a1512'
  strip-red: '#b52e22'
  strip-blue: '#2d5ea8'
  bulb: '#f0a93a'
  bulb-dim: '#6b4a1c'
  chrome-hi: '#fdfdfb'
  chrome: '#b8b6ae'
  chrome-lo: '#5f5d58'
typography:
  display:
    fontFamily: '"League Gothic", Impact, "Arial Narrow", sans-serif'
    fontSize: 84px
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: .02em
  headline:
    fontFamily: '"League Gothic", Impact, "Arial Narrow", sans-serif'
    fontSize: 56px
    lineHeight: 1
    letterSpacing: .12em
  title:
    fontFamily: '"League Gothic", Impact, "Arial Narrow", sans-serif'
    fontSize: 28px
    lineHeight: 1
    letterSpacing: .06em
  body:
    fontFamily: '"Special Elite", "Courier New", monospace'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: '"League Gothic", Impact, "Arial Narrow", sans-serif'
    fontSize: 13px
    letterSpacing: .14em
  strip-name:
    fontFamily: '"Special Elite", "Courier New", monospace'
    fontSize: 19px
    fontWeight: 500
    letterSpacing: .02em
rounded:
  strip: 3px
  pushbutton: 4px
  well: 6px
  device: 8px
  coin: 12px
  round: 50%
spacing:
  key-gap: 6px
  control-gap: 8px
  rack-gap: 14px
  body-gap: 16px
components:
  pb:
    textColor: '{colors.ink}'
    rounded: '{rounded.pushbutton}'
    height: 34px
    padding: 0 14px
  pb-small:
    textColor: '{colors.ink}'
    rounded: '{rounded.pushbutton}'
    height: 28px
    padding: 0 11px
  pb-tiny:
    textColor: '{colors.ink}'
    rounded: '{rounded.pushbutton}'
    height: 22px
    padding: 0 8px
  pb-big:
    textColor: '{colors.ink}'
    rounded: '{rounded.pushbutton}'
    height: 46px
    padding: '0'
  pb-lit:
    textColor: '{colors.ink}'
    rounded: '{rounded.pushbutton}'
    height: 34px
    padding: 0 14px
  sel:
    textColor: '{colors.ink}'
    rounded: '{rounded.strip}'
    width: 30px
    height: 30px
    padding: '0'
  title-strip:
    backgroundColor: '{colors.cream}'
    textColor: '{colors.ink}'
    rounded: '{rounded.strip}'
    padding: 5px 12px 6px 14px
  lanepad:
    backgroundColor: '{colors.cream}'
    textColor: '{colors.ink}'
    rounded: '{rounded.strip}'
    width: 132px
    height: 34px
    padding: 0 8px 0 10px
  strip-select:
    backgroundColor: '{colors.cream}'
    textColor: '{colors.ink}'
    rounded: '{rounded.strip}'
    height: 28px
  tab:
    rounded: '{rounded.strip}'
    height: 30px
    padding: 0 14px
  device:
    rounded: '{rounded.device}'
---

# Design System: NOISE — Select-O-Matic

## Overview

**Creative North Star: "The Select-O-Matic jukebox"**

NOISE presents its controls as a late-night jukebox cabinet: warm near-black lacquer, cream paper-like strips, red and blue rulings, chrome pushbuttons and amber indicators. Its dense hierarchy comes from physical grouping, material contrast and condensed lettering rather than spacious cards.

The same hardware vocabulary continues through the rack, lathe and editor: recessed displays sit inside raised plates; notes and arrangement blocks repeat the cream strip treatment. This document describes the built stylesheet and JavaScript, not every proposed detail in the surface brief.

**Key Characteristics:**
- Lacquer grounds, cream strips and chrome controls.
- Red/blue ink distinguishes strips and device content.
- Amber feedback, mechanical reels and tactile pressed states.
- Condensed display lettering paired with typewriter-like names and prose.

Source of truth: `styles.css`, `index.html`, `js/app.js`, `js/editor.js` and `js/knob.js`. The shared stylesheet also supplies detached-editor and manual-page styling. Sidecar snippets are CSS/HTML visual samples; application behavior remains in JavaScript.

## Colors

Warm black, paper cream and silver form the material base; red and blue are printed accents and amber supplies luminous feedback. Frontmatter preserves the root color declarations without renaming them.

### Primary
- **Bulb amber** (`bulb`): marquee light, live steps, knob arcs and values, focus, selection, caret and links.
- **Dim bulb** (`bulb-dim`): idle marquee bulbs and armed lamps before playback.

### Secondary
- **Strip red** (`strip-red`): upper strip rules, selected-step underlines, record labels, PREACHER scope and recording-button face.

### Tertiary
- **Strip blue** (`strip-blue`): lower strip rules, alternating device rules, field label blocks, record labels and CATHEDRAL scope.

### Neutral
- **Lacquer** (`lacquer`): cabinet and editor grounds; **panel**: canvas labels and rulers.
- **Cream** (`cream`): title strips, note blocks, readable inserts and light text. **Ink** (`ink`): dark text on cream or chrome.
- **Chrome high / chrome / chrome low**: highlights, metal midtone and shaded metal. The actual chrome gradient has additional fixed stops, retained in the sidecar CSS.
- `lacquer-2` and `cream-2` are declared in the stylesheet but have no consumers in the inspected sources; they are not assigned invented roles.

### Named Rules
**The Amber Light Rule.** Glowing bulbs and transport illumination use amber; red and blue remain ink and signal-trace colors. Amber also appears on static values, focus and emphasized controls, so its use is not exclusively gated by playback.

## Typography

**Display Font:** League Gothic, with Impact, Arial Narrow and sans-serif fallbacks.
**Body / Name Font:** Special Elite, with Courier New and monospace fallbacks.

Both fonts are self-hosted WOFF2, preloaded in the document, with `font-display: swap`. The font-face declarations expose weights 400–700 and 400–500 respectively. Special Elite reads as typewriter lettering, not a conventional hand-set book serif.

### Hierarchy
- **Display:** individual NOISE tiles use the frontmatter display role; desktop model lettering uses the headline role.
- **Title:** device headings use 28px; ordinary title strips use 22px, both with line-height 1. Mobile device titles use 24px.
- **Body:** the body role is 14px / 1.45. Manual paragraphs use 14px / 1.55 and a desktop maximum width of 46ch.
- **Names:** the song-title button uses 19px Special Elite, record names 15px and lathe names 16px.
- **Label:** knob labels use 13px condensed lettering with .14em tracking. Strip metadata uses 12px Special Elite with .04em tracking. Control typography varies by component rather than following a mathematical scale.
- **Numbers:** counter reels use 26px League Gothic in 34px-high cells. Counters, values, strip metadata and editor bars request tabular numerals.

## Layout

The centered cabinet has a maximum width of 1440px and padding `0 18px 60px`. The marquee uses `auto 1fr auto` columns; the transport uses `auto auto auto 1fr`. Devices stack with a 14px rack gap. Each plate has 22px side ears, a header and a body. The body pairs a flexible face with an auto-width knob bank; header padding is `12px 14px 8px`, body padding `6px 14px 14px`. Dense control groups use recurring 4px, 6px, 8px, 10px, 12px, 14px and 16px intervals; there is no global spacing-variable scale.

At **max-width 1180px**, device bodies and scope/key faces become one column; knobs flow horizontally, scopes become 120px high, the file strip spans the transport, and NOISE lettering drops to 64px.

At **max-width 820px**, cabinet padding becomes `0 10px 40px`; marquee and transport stack while navigation remains two columns. NOISE drops to 54px, model lettering to 28px. Device ears shrink to 10px and screws disappear. File keys use four columns. Small/tiny/big pushbuttons become 40px/34px/52px high (editor small buttons have a 36px override). The step grid keeps 16 columns and scrolls sideways with fixed lane labels, 40px steps and scroll nudges. Musical keys wrap into six 44px columns; slice keys become 48px by 44px. Glass is 160px high, waveform 130px; the manual becomes one column.

The docked editor is 460px high on desktop; mobile uses auto height with a 460px minimum canvas wrapper. Detached editor styling uses a full-viewport height and square corners. Independently of CSS breakpoints, editor canvas geometry switches to touch dimensions for a coarse pointer or canvas width below 700px. It draws its own scrollbars and preserves minimum cell sizes instead of squeezing all steps into view.

## Elevation & Depth

Depth is structural: multiple inset highlights and lower edges make keys protrude; dark inset shadows recess counters, sliders, scopes and glass. Device plates use a thin inset seam and diffuse downward shadow. This is not a flat system. Chrome uses a multi-stop vertical gradient, not a solid silver swatch. Glass has a diagonal translucent reflection and a chrome lower rail.

### Shadow Vocabulary
- **Strip:** `var(--strip-shadow)` combines a white inner upper edge, dark inner lower edge and a one-pixel outer seam.
- **Pushbutton:** a white inner highlight, dark inner bottom, three-pixel base and short diffuse shadow; pressing shifts it down 2px and shortens the base.
- **Device:** inset seam and subtle upper highlight, plus `0 14px 30px -18px #000`.
- **Display well:** a two-pixel inset rim and a broad black inset shadow.
- **Lamp:** concentric dark rims, with amber bloom when armed and playing; beat pulses use a pale warm core.

Exact shadow declarations and complete sampled component CSS are in the sidecar.

## Shapes

Small rectangular inserts dominate: strips, tabs and selectors have 3px corners; pushbuttons and counter housings 4px; display wells and knob banks 6px; plates and the editor 8px. The coin button is a 108px square with 12px corners. Knobs, lamps and screw heads are circular. Carousel glass has `10px 10px 4px 4px` corners. Native vertical sliders sit in narrow pill-shaped black wells. These shapes coexist; a single universal radius would not describe the build.

## Components

### Chrome pushbuttons
The raised chrome button (`.pb`) is 34px high with `0 14px` padding, 15px condensed lettering and .1em tracking. Small, tiny and big variants change dimensions; the big variant is 56px wide. Hover brightens to 1.06. Active and `is-on` translate down 2px; `is-on` also switches to amber. The `--lit` variant is a permanently warm emphasis face, not a playback state. Disabled buttons have .55 opacity and a progress cursor. Global keyboard focus is a 2px amber outline with 2px offset.

### Title strips and lane pads
Cream title strips have red upper and blue lower 2px rules, reversed under blue devices. Names and metadata truncate unless the info-strip variant allows metadata wrapping. The song name is a button that invokes a native rename prompt and underlines red on hover. Lane pads use the same ruled insert as an audition button; hit/active states shift down 1px and become amber. Lane tuning is displayed separately.

### Selector keys
Chrome letter/number keys (`.sel`) are 30px square at base; selected steps become cream with a red underline, while `is-now` marks the sounding column in amber. Active/`is-hit` shifts down 2px. Selected-plus-current has a lighter warm face. Slice keys are 44px by 36px. The final desktop musical-key rule overrides the earlier declaration: width 36px, auto height, minimum 48px, 12px text and 6px bottom padding. Black keys have their own dark gradient. Selected content and transport position are distinct states.

### Knobs, counters and levers
The rotary knob has an SVG chrome rim and dark cap, cream pointer and amber arc. Its focusable cap exposes ARIA slider minimum, maximum, current value and formatted value text. Vertical dragging changes value, Shift refines drag, wheel adjusts, arrow keys step, Home/End reach bounds and double-click resets. Default cap size is 58px; special three-knob banks use 76px until the intermediate breakpoint. Mobile defaults use 64px, but the more-specific three-knob-bank rule retains 58px.

Mechanical counters contain clipped 24px-by-34px drums and translated digit reels. Default roll is .28s with `cubic-bezier(.2,.8,.2,1)`; BAR uses .16s and STEP .05s. Counter status labels update without live announcements. Vertical native ranges use chrome thumbs; labels sit above and amber values below.

### Device plates and displays
Device plates (`.device`) frame their content with shaded side ears and slotted screw pseudo-elements. Armed lamps are dim until playback, then glow amber and briefly brighten on beats. Carousel glass contains canvas-drawn records, carriage and tone arm. Scopes use recessed gridded wells. The VU is a cream 240px-by-96px meter with a red needle and chrome pivot; its transform transition is .08s linear.

### Navigation, fields and editor controls
Cabinet links are cream inserts with red/blue code blocks, 36px high on desktop and 44px on mobile; hover brightens them. Editor tabs switch from dark recessed faces to cream when selected and update `aria-selected`. Pattern strip buttons change chrome to cream and add a red underline; ghost add/remove buttons are dark. Strip-select fields combine a blue condensed label block with a cream native select. Their desktop height is 28px, mobile 36px. No custom text-input skin or chip component is present in these sources.

### Canvas surfaces
Editor notes are cream strips with red/blue velocity marks; sounding notes and playheads use amber, selected notes receive amber outlines. Song blocks repeat red/blue top/bottom rules. Editor and lathe read core colors from root variables, but cache or supplement them with fixed values. Scopes read amber/red/blue variables. Carousel drawing uses hard-coded matching colors and additional metal shades, not live-bound root variables. Lathe alternating translucent bands also use fixed RGBA values, including a red that differs from `strip-red`.

### Feedback and state grammar
Toast messages are fixed cream strips with blue/red rules, a polite live region and a .25s slide/fade; warnings use red on both rules. `body.is-dropping` displays the full-screen dark drop overlay with a dashed amber border.

`body.is-lit` is set after audio unlock (coin or an audition that calls the same gate), brightening marquee tiles and bulbs. `body.is-playing` enables the 1.2s stepped bulb chase and armed lamps; audio RMS modulates cabinet glow. Stopping leaves the unlocked cabinet lit. `body.is-recording` makes the microphone button red with a one-second stepped brightness pulse; it does not produce the brief's proposed red/blue cabinet lighting. `body.is-detached` hides the docked editor and reveals its return placeholder.

The idle coin beckons with a 2.2s brightness pulse. `prefers-reduced-motion: reduce` disables marquee chase, coin beckon, reel transition and recording pulse. It does not disable all transitions, JavaScript canvas animation, smooth scrolling or beat flashes. These limits are recorded, not promoted into accessibility guarantees.

## Do's and Don'ts

### Do:
- Do preserve the cream-strip, ink-text and red/blue ruling combination.
- Do retain amber focus outlines and textual control values alongside visual feedback.
- Do keep horizontal step scrolling and the larger mobile control variants.
- Do distinguish selected content from the currently sounding step.

### Don't:
- Don't treat strip-red and strip-blue as interchangeable with amber transport glow.
- Don't replace the built chrome gradients and recessed wells with flat generic cards.
- Don't claim every amber element is playback-gated or every animation is disabled by reduced motion.
- Don't claim all canvas colors are live-bound CSS variables.

Not canonized or repaired: the DETACH control's arrow glyph is an incumbent detail, not an icon-system rule. Hard-coded canvas colors and partial reduced-motion coverage remain implementation limitations. No new palette shades, font-license assertions or unimplemented lighting states are inferred from the brief.
