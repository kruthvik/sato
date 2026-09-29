import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import {
	loadIntegrationsConfig,
	saveIntegrationsConfig,
	toggleIntegration,
	updateIntegration,
	addIntegration,
	type Integration,
} from "../.pi/core/integrations.ts";
import {
	loadThemes,
	getActiveTheme,
	setActiveTheme,
	addTheme,
	removeTheme,
	type ThemeDefinition,
} from "../.pi/core/themes.ts";
import {
	getInstalledPackages,
	installPackage,
	updatePackages,
	removePackage,
	POPULAR_EXTENSIONS,
	type PackageInfo,
} from "../.pi/core/packages.ts";

const PORT = 38475;
const cwd = process.cwd();

function htmlUi(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Learn — Settings & Integration Hub</title>
<meta name="description" content="Configure study tools, packages, and visual themes for Learn.">
<style>
:root {
  color-scheme: dark;
  --canvas: #080808;
  --canvas-tint: #111111;
  --grouped: #111111;
  --sheet: #181818;
  --text: #ffffff;
  --text-secondary: #c2c2c2;
  --muted: #999999;
  --border: rgba(255,255,255,.12);
  --border-strong: rgba(255,255,255,.28);
  --indigo: #f4f4f4;
  --indigo-hover: #d6d6d6;
  --indigo-soft: #252525;
  --sage: #34d399;
  --sage-soft: #16382d;
  --danger: #ff928a;
  --control-radius: 4px;
  --container-radius: 4px;
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-display: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --shadow-sm: none;
  --shadow-modal: 0 24px 64px rgba(0,0,0,.65);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  min-width: 320px;
  min-height: 100dvh;
  background: var(--canvas);
  color: var(--text);
  font-family: var(--font);
  font-size: 0.9375rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
button, input, textarea { font: inherit; }
button { -webkit-tap-highlight-color: transparent; }
.skip-link {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 30;
  padding: 0.625rem 0.875rem;
  border-radius: var(--control-radius);
  background: var(--text);
  color: #fff;
  transform: translateY(-150%);
  transition: transform 180ms ease;
}
.skip-link:focus { transform: translateY(0); }
.page-shell {
  width: min(100% - 3rem, 1120px);
  margin-inline: auto;
  padding: 2.5rem 0 5rem;
}
header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 2rem;
  padding: 1rem 0 2rem;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  color: var(--indigo);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}
.eyebrow-mark {
  width: 0.5rem;
  height: 0.5rem;
  background: var(--indigo);
  border-radius: 1px;
}
.brand h1 {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4vw, 3.25rem);
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.05;
}
.brand p {
  max-width: 44ch;
  margin-top: 0.75rem;
  color: var(--text-secondary);
  font-size: 0.95rem;
  text-wrap: pretty;
}
.badge-live {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--sage);
  border-radius: var(--control-radius);
  background: var(--sage-soft);
  color: var(--sage);
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dot {
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 50%;
  background: var(--sage);
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.12);
}

/* Nav Tabs */
.nav-tabs {
  display: flex;
  gap: 0.5rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2rem;
}
.tab-btn {
  padding: 0.75rem 1.25rem;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 150ms ease;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active {
  color: var(--text);
  border-bottom-color: var(--text);
}

main { display: block; }
.tab-pane { display: none; }
.tab-pane.active { display: block; }

.callout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  margin-bottom: 2.75rem;
  padding: 1.25rem 1.5rem 1.35rem;
  border: 1px solid var(--border);
  border-radius: var(--container-radius);
  background: var(--canvas-tint);
  color: var(--text-secondary);
  font-size: 0.875rem;
}
.callout-icon {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border-radius: var(--control-radius);
  background: var(--indigo-soft);
  color: var(--indigo);
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1;
}
.callout strong {
  display: block;
  margin-bottom: 0.125rem;
  color: var(--text);
  font-weight: 600;
}
.integrations-section, .packages-section, .themes-section {
  padding: 1.75rem;
  border-radius: var(--container-radius);
  background: var(--grouped);
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}
.section-heading h2 {
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.1;
}
.stats {
  display: flex;
  gap: 1rem;
  margin-top: 0.55rem;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stats div + div::before {
  content: "·";
  margin-right: 1rem;
  color: var(--border-strong);
}
.stats span { color: var(--text-secondary); }
#stat-active { color: var(--sage); }
.toolbar-actions {
  display: flex;
  gap: 0.75rem;
}
button.btn {
  min-height: 2.5rem;
  padding: 0.6rem 0.95rem;
  border: 1px solid var(--indigo);
  border-radius: var(--control-radius);
  background: var(--indigo);
  color: #111;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 120ms ease;
}
button.btn:hover { opacity: 0.88; }
button.btn-sec {
  background: transparent;
  color: var(--text);
  border-color: var(--border-strong);
}
button.btn-sec:hover {
  background: var(--canvas-tint);
}
button.btn-danger {
  background: transparent;
  color: var(--danger);
  border-color: rgba(255, 146, 138, 0.3);
}
button.btn-danger:hover {
  background: rgba(255, 146, 138, 0.1);
}
button.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}
.card {
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--container-radius);
  background: var(--sheet);
  display: flex;
  flex-direction: column;
  transition: border-color 150ms ease;
}
.card:hover {
  border-color: var(--border-strong);
}
.card.disabled {
  opacity: 0.65;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.card-title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.2;
}
.category-tag {
  display: inline-block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.card-desc {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: 1rem;
  flex: 1;
}
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
  font-size: 0.8rem;
}
.item-id {
  color: var(--muted);
  font-family: monospace;
  font-size: 0.75rem;
}
.settings-toggle {
  background: none;
  border: none;
  color: var(--indigo);
  cursor: pointer;
  padding: 0;
  font-size: 0.8rem;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.card-settings {
  display: none;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--border);
}
.card-settings.open { display: block; }

/* Switch widget */
.switch-wrap {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.switch {
  position: relative;
  width: 2.5rem;
  height: 1.35rem;
  display: inline-block;
}
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute;
  inset: 0;
  background-color: var(--canvas-tint);
  border: 1px solid var(--border-strong);
  border-radius: 9999px;
  transition: 180ms ease;
}
.slider::before {
  position: absolute;
  content: "";
  height: 0.95rem;
  width: 0.95rem;
  left: 2px;
  bottom: 2px;
  background-color: var(--muted);
  border-radius: 50%;
  transition: 180ms ease;
}
input:checked + .slider {
  background-color: var(--sage);
  border-color: var(--sage);
}
input:checked + .slider::before {
  transform: translateX(1.15rem);
  background-color: #080808;
}

/* Modals */
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  place-items: center;
  padding: 1rem;
}
.modal-overlay.open { display: grid; }
.modal {
  background: var(--sheet);
  border: 1px solid var(--border-strong);
  border-radius: var(--container-radius);
  width: min(100%, 540px);
  padding: 2rem;
  box-shadow: var(--shadow-modal);
}
.modal-kicker {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--indigo);
  letter-spacing: 0.08em;
  margin-bottom: 0.35rem;
}
.modal h2 {
  font-family: var(--font-display);
  font-size: 1.5rem;
  margin-bottom: 0.35rem;
}
.modal-intro {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
}
.form-group {
  margin-bottom: 1.25rem;
}
.field-lbl {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.4rem;
  color: var(--text-secondary);
}
.txt {
  width: 100%;
  padding: 0.65rem 0.85rem;
  background: var(--canvas);
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  color: var(--text);
  font-size: 0.875rem;
}
.txt:focus {
  outline: 2px solid var(--indigo);
  outline-offset: 1px;
}
.modal-btns {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.75rem;
}

/* Theme Swatches */
.swatch-group {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.5rem;
  margin-bottom: 0.75rem;
}
.swatch {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.15);
}
.active-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  background: var(--sage-soft);
  color: var(--sage);
  border: 1px solid var(--sage);
  border-radius: var(--control-radius);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
}
.badge-essential {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  background: var(--indigo-soft);
  color: var(--indigo);
  border-radius: var(--control-radius);
  font-size: 0.7rem;
  font-weight: 600;
  margin-top: 0.25rem;
}
.pkg-actions {
  display: flex;
  gap: 0.5rem;
}
.quick-picks {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--canvas-tint);
  border-radius: var(--control-radius);
  font-size: 0.8rem;
}
.quick-picks-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.pick-btn {
  padding: 0.3rem 0.6rem;
  background: var(--sheet);
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  color: var(--text);
  font-size: 0.75rem;
  cursor: pointer;
}
.pick-btn:hover { background: var(--canvas); }
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="page-shell">
  <header>
    <div class="brand">
      <div class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Learn workspace</div>
      <h1>Settings & integration hub</h1>
      <p>Configure study integrations, runtime packages, and visual themes for your self-contained learning ecosystem.</p>
    </div>
    <div class="badge-live" role="status">
      <span class="dot" aria-hidden="true"></span> Running on port ${PORT}
    </div>
  </header>

  <!-- Navigation Tabs -->
  <nav class="nav-tabs" aria-label="Settings Sections">
    <button type="button" class="tab-btn active" onclick="switchTab('integrations')">Integrations</button>
    <button type="button" class="tab-btn" onclick="switchTab('packages')">Packages & Extensions</button>
    <button type="button" class="tab-btn" onclick="switchTab('themes')">Themes & Appearance</button>
  </nav>

  <main id="main-content">
    <!-- SECTION 1: INTEGRATIONS -->
    <div class="tab-pane active" id="pane-integrations">
      <aside class="callout" aria-labelledby="principle-title">
        <span class="callout-icon" aria-hidden="true">i</span>
        <div>
          <strong id="principle-title">You stay in control of every tool.</strong>
          Enabling an API makes it available when it supports your work—for example, Desmos for graphing or interactive sheets for accounting. Learn will always ask before opening a specialized browser tool.
        </div>
      </aside>

      <section class="integrations-section" aria-labelledby="integrations-title">
        <div class="toolbar">
          <div class="section-heading">
            <h2 id="integrations-title">Your integrations</h2>
            <div class="stats" aria-live="polite">
              <div>Total <span id="stat-total">0</span></div>
              <div>Active <span id="stat-active">0</span></div>
            </div>
          </div>
          <button type="button" class="btn" onclick="openAddModal()"><span aria-hidden="true">＋</span> Add custom API</button>
        </div>

        <div class="grid" id="integrationsGrid"></div>
      </section>
    </div>

    <!-- SECTION 2: PACKAGES -->
    <div class="tab-pane" id="pane-packages">
      <aside class="callout">
        <span class="callout-icon" aria-hidden="true">⚙</span>
        <div>
          <strong>Hermetic learning profile (.learn-runtime).</strong>
          All packages and Pi extensions are installed directly within this workspace. Global ~/.pi/agent is completely untouched and isolated.
        </div>
      </aside>

      <section class="packages-section" aria-labelledby="packages-title">
        <div class="toolbar">
          <div class="section-heading">
            <h2 id="packages-title">Installed Packages</h2>
            <div class="stats" aria-live="polite">
              <div>Total <span id="pkg-total">0</span></div>
              <div>Core Providers <span id="pkg-essential">0</span></div>
            </div>
          </div>
          <div class="toolbar-actions">
            <button type="button" class="btn btn-sec" onclick="updateAllPackages()">↻ Update All</button>
            <button type="button" class="btn" onclick="openPkgModal()"><span aria-hidden="true">＋</span> Install Package</button>
          </div>
        </div>

        <div class="grid" id="packagesGrid"></div>
      </section>
    </div>

    <!-- SECTION 3: THEMES -->
    <div class="tab-pane" id="pane-themes">
      <aside class="callout">
        <span class="callout-icon" aria-hidden="true">🎨</span>
        <div>
          <strong>Local offline appearance themes.</strong>
          Themes apply locally across your Pi session and browser surfaces with 0 external CDN calls.
        </div>
      </aside>

      <section class="themes-section" aria-labelledby="themes-title">
        <div class="toolbar">
          <div class="section-heading">
            <h2 id="themes-title">Workspace Themes</h2>
            <div class="stats" aria-live="polite">
              <div>Active Theme: <span id="theme-active-name" style="color:var(--sage)">dark</span></div>
            </div>
          </div>
          <button type="button" class="btn" onclick="openThemeModal()"><span aria-hidden="true">＋</span> Add Custom Theme</button>
        </div>

        <div class="grid" id="themesGrid"></div>
      </section>
    </div>
  </main>
</div>

<!-- Modal 1: Add Integration -->
<div class="modal-overlay" id="addModal" role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-modal-title" aria-describedby="add-modal-description">
    <div class="modal-kicker">New capability</div>
    <h2 id="add-modal-title">Add a custom integration</h2>
    <p class="modal-intro" id="add-modal-description">Connect a study tool or API to make it available in your Learn workspace.</p>
    <form id="addForm" onsubmit="submitAdd(event)">
      <div class="form-group">
        <label class="field-lbl" for="newId">Integration ID · e.g. chemistry-3d</label>
        <input type="text" class="txt" id="newId" required pattern="[a-zA-Z0-9_-]+" placeholder="chemistry-3d" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="newName">Display name</label>
        <input type="text" class="txt" id="newName" required placeholder="3D Molecular Viewer" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="newCategory">Subject category</label>
        <input type="text" class="txt" id="newCategory" required placeholder="Chemistry" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="newScript">Script URL · Optional</label>
        <input type="url" class="txt" id="newScript" placeholder="https://example.com/library.js" autocomplete="url">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="newDesc">Description and purpose</label>
        <textarea class="txt" id="newDesc" rows="2" required placeholder="Interactive molecular simulation..."></textarea>
      </div>
      <div class="form-group">
        <label class="field-lbl" for="newSettings">Settings JSON · Optional</label>
        <textarea class="txt" id="newSettings" rows="2" spellcheck="false" placeholder='{"theme": "light"}'></textarea>
      </div>
      <div class="modal-btns">
        <button type="button" class="btn btn-sec" onclick="closeAddModal()">Cancel</button>
        <button type="submit" class="btn">Add integration</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal 2: Install Package -->
<div class="modal-overlay" id="pkgModal" role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pkg-modal-title">
    <div class="modal-kicker">Local Package Manager</div>
    <h2 id="pkg-modal-title">Install Package</h2>
    <p class="modal-intro">Add an extension or tool into your isolated learning profile.</p>
    <form id="pkgForm" onsubmit="submitInstallPkg(event)">
      <div class="form-group">
        <label class="field-lbl" for="pkgName">Package Name or Specifier</label>
        <input type="text" class="txt" id="pkgName" required placeholder="npm:@narumitw/pi-plan-mode" autocomplete="off">
      </div>
      <div class="quick-picks">
        <strong>Suggested Study Extensions:</strong>
        <div class="quick-picks-list" id="popularPickList"></div>
      </div>
      <div class="modal-btns">
        <button type="button" class="btn btn-sec" onclick="closePkgModal()">Cancel</button>
        <button type="submit" class="btn" id="pkgSubmitBtn">Install</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal 3: Add Custom Theme -->
<div class="modal-overlay" id="themeModal" role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="theme-modal-title">
    <div class="modal-kicker">Appearance</div>
    <h2 id="theme-modal-title">Create Custom Theme</h2>
    <p class="modal-intro">Add a custom color theme saved directly in .pi/themes.</p>
    <form id="themeForm" onsubmit="submitAddTheme(event)">
      <div class="form-group">
        <label class="field-lbl" for="themeId">Theme ID · e.g. amethyst</label>
        <input type="text" class="txt" id="themeId" required pattern="[a-zA-Z0-9_-]+" placeholder="amethyst" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="themeDisplayName">Display Name</label>
        <input type="text" class="txt" id="themeDisplayName" required placeholder="Amethyst Night" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="themeDesc">Description</label>
        <input type="text" class="txt" id="themeDesc" required placeholder="Deep violet tones for focused study" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="themeCanvas">Background Color (Hex)</label>
        <input type="text" class="txt" id="themeCanvas" required value="#0e0a14" placeholder="#0e0a14">
      </div>
      <div class="form-group">
        <label class="field-lbl" for="themeAccent">Accent Color (Hex)</label>
        <input type="text" class="txt" id="themeAccent" required value="#c084fc" placeholder="#c084fc">
      </div>
      <div class="modal-btns">
        <button type="button" class="btn btn-sec" onclick="closeThemeModal()">Cancel</button>
        <button type="submit" class="btn">Create Theme</button>
      </div>
    </form>
  </div>
</div>

<script>
let state = [];
let packagesState = [];
let themesState = { active: 'dark', themes: [] };

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  if (tabId === 'integrations') {
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
    document.getElementById('pane-integrations').classList.add('active');
  } else if (tabId === 'packages') {
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    document.getElementById('pane-packages').classList.add('active');
    loadPackages();
  } else if (tabId === 'themes') {
    document.querySelectorAll('.tab-btn')[2].classList.add('active');
    document.getElementById('pane-themes').classList.add('active');
    loadThemes();
  }
}

async function load() {
  try {
    const res = await fetch('/api/integrations');
    state = await res.json();
    renderIntegrations();
  } catch (err) {
    console.error('Failed to load integrations', err);
  }
}

function renderIntegrations() {
  const grid = document.getElementById('integrationsGrid');
  grid.innerHTML = '';
  let active = 0;

  state.forEach(item => {
    if (item.enabled) active++;
    const card = document.createElement('article');
    card.className = 'card ' + (item.enabled ? '' : 'disabled');
    card.id = 'card_' + item.id;
    
    card.innerHTML = \`
      <div class="card-top">
        <div>
          <h3 class="card-title">\${item.name}</h3>
          <span class="category-tag">\${item.category}</span>
        </div>
        <label class="switch-wrap" aria-label="Enable \${item.name}">
          <span class="switch">
            <input type="checkbox" \${item.enabled ? 'checked' : ''} onchange="toggle('\${item.id}', this.checked)">
            <span class="slider" aria-hidden="true"></span>
          </span>
        </label>
      </div>
      <p class="card-desc">\${item.description}</p>
      <div class="card-footer">
        <button type="button" class="settings-toggle" aria-expanded="false" aria-controls="settings_\${item.id}" onclick="toggleSettings('\${item.id}', this)">Configure settings</button>
        <span class="item-id">\${item.id}</span>
      </div>
      <div class="card-settings" id="settings_\${item.id}">
        <div class="form-group">
          <label class="field-lbl" for="url_\${item.id}">Script URL</label>
          <input type="text" class="txt" id="url_\${item.id}" value="\${item.scriptUrl || ''}" placeholder="No external script needed">
        </div>
        <div class="form-group">
          <label class="field-lbl" for="cfg_\${item.id}">Configuration or API settings (JSON)</label>
          <textarea class="txt" id="cfg_\${item.id}" rows="3" spellcheck="false">\${JSON.stringify(item.settings || {}, null, 2)}</textarea>
        </div>
        <button type="button" class="btn btn-sec" onclick="saveItemSettings('\${item.id}')">Save changes</button>
      </div>
    \`;
    grid.appendChild(card);
  });

  document.getElementById('stat-total').textContent = state.length;
  document.getElementById('stat-active').textContent = active;
}

async function toggle(id, checked) {
  try {
    const res = await fetch('/api/integrations/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: checked })
    });
    if (res.ok) {
      const item = state.find(i => i.id === id);
      if (item) item.enabled = checked;
      renderIntegrations();
    }
  } catch (err) {
    alert('Error updating status: ' + err.message);
  }
}

function toggleSettings(id, trigger) {
  const el = document.getElementById('settings_' + id);
  if (el) {
    const isOpen = el.classList.toggle('open');
    if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
  }
}

async function saveItemSettings(id) {
  const url = document.getElementById('url_' + id).value;
  const cfgRaw = document.getElementById('cfg_' + id).value;
  let settings = {};
  try {
    if (cfgRaw.trim()) settings = JSON.parse(cfgRaw);
  } catch {
    alert('Invalid JSON in Settings field');
    return;
  }
  try {
    const res = await fetch('/api/integrations/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, updates: { scriptUrl: url, settings } })\
    });
    if (res.ok) {
      alert('Settings saved for ' + id);
      load();
    }
  } catch (err) {
    alert('Failed to save settings: ' + err.message);
  }
}

/* Modal 1: Integrations */
function openAddModal() {
  document.getElementById('addModal').classList.add('open');
  document.getElementById('newId').focus();
}
function closeAddModal() {
  document.getElementById('addModal').classList.remove('open');
}

/* Modal 2: Packages */
function openPkgModal() {
  document.getElementById('pkgModal').classList.add('open');
  document.getElementById('pkgName').focus();
}
function closePkgModal() {
  document.getElementById('pkgModal').classList.remove('open');
}

/* Modal 3: Themes */
function openThemeModal() {
  document.getElementById('themeModal').classList.add('open');
  document.getElementById('themeId').focus();
}
function closeThemeModal() {
  document.getElementById('themeModal').classList.remove('open');
}

/* Packages API */
async function loadPackages() {
  try {
    const res = await fetch('/api/packages');
    const data = await res.json();
    packagesState = data.packages || [];
    renderPackages();
    renderPopularPackages(data.popular || []);
  } catch (err) {
    console.error('Failed to load packages', err);
  }
}

function renderPopularPackages(popular) {
  const container = document.getElementById('popularPickList');
  if (!container) return;
  container.innerHTML = '';
  popular.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick-btn';
    btn.textContent = p.name.replace('npm:', '');
    btn.title = p.description;
    btn.onclick = () => {
      document.getElementById('pkgName').value = p.name;
    };
    container.appendChild(btn);
  });
}

function renderPackages() {
  const grid = document.getElementById('packagesGrid');
  grid.innerHTML = '';
  let essentialCount = 0;

  packagesState.forEach(pkg => {
    if (pkg.isEssential) essentialCount++;
    const card = document.createElement('article');
    card.className = 'card';
    const tag = pkg.isEssential ? '<span class="badge-essential">Core Learning Provider</span>' : '<span class="category-tag">Extension</span>';
    
    card.innerHTML = \`
      <div class="card-top">
        <div>
          <h3 class="card-title">\${pkg.name}</h3>
          \${tag}
        </div>
      </div>
      <p class="card-desc">\${pkg.description || 'Installed in .learn-runtime'}\${pkg.version ? ' · v' + pkg.version : ''}</p>
      <div class="card-footer">
        <span class="item-id">\${pkg.installed ? 'Installed' : 'Configured'}</span>
        <div class="pkg-actions">
          <button type="button" class="btn btn-sec" style="min-height:2rem;padding:0.25rem 0.6rem;font-size:0.75rem;" onclick="updateSinglePackage('\${pkg.name}')">Update</button>
          \${!pkg.isEssential ? \`<button type="button" class="btn btn-danger" style="min-height:2rem;padding:0.25rem 0.6rem;font-size:0.75rem;" onclick="removeSinglePackage('\${pkg.name}')">Remove</button>\` : ''}
        </div>
      </div>
    \`;
    grid.appendChild(card);
  });

  document.getElementById('pkg-total').textContent = packagesState.length;
  document.getElementById('pkg-essential').textContent = essentialCount;
}

async function submitInstallPkg(e) {
  e.preventDefault();
  const pkg = document.getElementById('pkgName').value.trim();
  if (!pkg) return;
  const btn = document.getElementById('pkgSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Installing...';
  try {
    const res = await fetch('/api/packages/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkg })
    });
    const result = await res.json();
    if (result.success) {
      closePkgModal();
      document.getElementById('pkgForm').reset();
      loadPackages();
    } else {
      alert('Installation failed: ' + result.output);
    }
  } catch (err) {
    alert('Failed to install package: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Install';
  }
}

async function updateAllPackages() {
  if (!confirm('Update all packages in the isolated runtime?')) return;
  try {
    const res = await fetch('/api/packages/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await res.json();
    alert(result.success ? 'Packages updated successfully!' : 'Update output: ' + result.output);
    loadPackages();
  } catch (err) {
    alert('Failed to update packages: ' + err.message);
  }
}

async function updateSinglePackage(pkgName) {
  try {
    const res = await fetch('/api/packages/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkgName })
    });
    const result = await res.json();
    alert(result.success ? 'Updated ' + pkgName : 'Update output: ' + result.output);
    loadPackages();
  } catch (err) {
    alert('Failed to update: ' + err.message);
  }
}

async function removeSinglePackage(pkgName) {
  if (!confirm('Remove package ' + pkgName + '?')) return;
  try {
    const res = await fetch('/api/packages/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkgName })
    });
    const result = await res.json();
    if (result.success) {
      loadPackages();
    } else {
      alert('Removal failed: ' + result.output);
    }
  } catch (err) {
    alert('Failed to remove: ' + err.message);
  }
}

/* Themes API */
async function loadThemes() {
  try {
    const res = await fetch('/api/themes');
    themesState = await res.json();
    renderThemes();
  } catch (err) {
    console.error('Failed to load themes', err);
  }
}

function renderThemes() {
  const grid = document.getElementById('themesGrid');
  grid.innerHTML = '';
  document.getElementById('theme-active-name').textContent = themesState.active;

  themesState.themes.forEach(theme => {
    const isActive = theme.name.toLowerCase() === themesState.active.toLowerCase();
    const card = document.createElement('article');
    card.className = 'card' + (isActive ? ' active-theme' : '');

    const canvasColor = theme.tokens?.['--canvas'] || (theme.type === 'light' ? '#fbfbfb' : '#080808');
    const tintColor = theme.tokens?.['--sheet'] || '#181818';
    const accentColor = theme.tokens?.['--indigo'] || '#f4f4f4';
    const sageColor = theme.tokens?.['--sage'] || '#34d399';

    card.innerHTML = \`
      <div class="card-top">
        <div>
          <h3 class="card-title">\${theme.displayName || theme.name}</h3>
          <span class="category-tag">\${theme.type} theme\${theme.isCustom ? ' · Custom' : ''}</span>
        </div>
        \${isActive ? '<span class="active-pill">Active</span>' : ''}
      </div>
      <div class="swatch-group">
        <div class="swatch" style="background:\${canvasColor}" title="Background"></div>
        <div class="swatch" style="background:\${tintColor}" title="Sheet"></div>
        <div class="swatch" style="background:\${accentColor}" title="Accent"></div>
        <div class="swatch" style="background:\${sageColor}" title="Positive"></div>
      </div>
      <p class="card-desc">\${theme.description || 'Local offline theme'}</p>
      <div class="card-footer">
        <span class="item-id">\${theme.name}</span>
        <button type="button" class="btn \${isActive ? 'btn-sec' : ''}" style="min-height:2rem;padding:0.25rem 0.75rem;font-size:0.75rem;" \${isActive ? 'disabled' : ''} onclick="activateTheme('\${theme.name}')">
          \${isActive ? 'Current' : 'Activate'}
        </button>
      </div>
    \`;
    grid.appendChild(card);
  });
}

async function activateTheme(themeName) {
  try {
    const res = await fetch('/api/themes/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: themeName })
    });
    if (res.ok) {
      themesState.active = themeName;
      // Dynamically apply tokens if found
      const themeObj = themesState.themes.find(t => t.name.toLowerCase() === themeName.toLowerCase());
      if (themeObj && themeObj.tokens) {
        for (const [k, v] of Object.entries(themeObj.tokens)) {
          document.documentElement.style.setProperty(k, v);
        }
      }
      renderThemes();
    }
  } catch (err) {
    alert('Failed to set theme: ' + err.message);
  }
}

async function submitAddTheme(e) {
  e.preventDefault();
  const id = document.getElementById('themeId').value.trim();
  const displayName = document.getElementById('themeDisplayName').value.trim();
  const description = document.getElementById('themeDesc').value.trim();
  const canvas = document.getElementById('themeCanvas').value.trim();
  const accent = document.getElementById('themeAccent').value.trim();

  const tokens = {
    "--canvas": canvas,
    "--canvas-tint": canvas,
    "--grouped": canvas,
    "--sheet": "#1c1f27",
    "--border": "rgba(255,255,255,0.12)",
    "--border-strong": "rgba(255,255,255,0.28)",
    "--text": "#ffffff",
    "--text-secondary": "#c2c2c2",
    "--muted": "#999999",
    "--indigo": accent,
    "--indigo-hover": accent,
    "--indigo-soft": "#2e1065",
    "--sage": "#34d399",
    "--sage-soft": "#16382d",
    "--danger": "#ff928a"
  };

  try {
    const res = await fetch('/api/themes/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: id, displayName, description, type: 'dark', tokens })
    });
    if (res.ok) {
      closeThemeModal();
      document.getElementById('themeForm').reset();
      loadThemes();
    }
  } catch (err) {
    alert('Failed to add theme: ' + err.message);
  }
}

async function submitAdd(e) {
  e.preventDefault();
  const id = document.getElementById('newId').value;
  const name = document.getElementById('newName').value;
  const category = document.getElementById('newCategory').value;
  const scriptUrl = document.getElementById('newScript').value;
  const description = document.getElementById('newDesc').value;
  const cfgRaw = document.getElementById('newSettings').value;
  let settings = {};
  try {
    if (cfgRaw.trim()) settings = JSON.parse(cfgRaw);
  } catch {
    alert('Invalid JSON in Settings field');
    return;
  }
  try {
    const res = await fetch('/api/integrations/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, category, scriptUrl, description, settings })
    });
    if (res.ok) {
      closeAddModal();
      document.getElementById('addForm').reset();
      load();
    }
  } catch (err) {
    alert('Failed to add integration: ' + err.message);
  }
}

load();
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

	if (req.method === "GET" && url.pathname === "/") {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(htmlUi());
		return;
	}

	// Integrations API
	if (req.method === "GET" && url.pathname === "/api/integrations") {
		const config = loadIntegrationsConfig(cwd);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(config.integrations));
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/integrations/toggle") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { id, enabled } = JSON.parse(body);
			const updated = toggleIntegration(id, enabled, cwd);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(updated));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/integrations/update") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { id, updates } = JSON.parse(body);
			const updated = updateIntegration(id, updates, cwd);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(updated));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/integrations/add") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const data = JSON.parse(body);
			const created = addIntegration(data, cwd);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(created));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

	// Packages API
	if (req.method === "GET" && url.pathname === "/api/packages") {
		const packages = getInstalledPackages(cwd);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ packages, popular: POPULAR_EXTENSIONS }));
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/packages/install") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { package: pkg } = JSON.parse(body);
			const result = installPackage(pkg, cwd);
			res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: false, output: err.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/packages/update") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const parsed = body ? JSON.parse(body) : {};
			const result = updatePackages(parsed.package, cwd);
			res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: false, output: err.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/packages/remove") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { package: pkg } = JSON.parse(body);
			const result = removePackage(pkg, cwd);
			res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: false, output: err.message }));
		}
		return;
	}

	// Themes API
	if (req.method === "GET" && url.pathname === "/api/themes") {
		const active = getActiveTheme(cwd);
		const themes = loadThemes(cwd);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ active, themes }));
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/themes/set") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { theme } = JSON.parse(body);
			setActiveTheme(theme, cwd);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: true, active: theme }));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/themes/add") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const themeData = JSON.parse(body);
			const created = addTheme(themeData, cwd);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: true, theme: created }));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/themes/remove") {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { name } = JSON.parse(body);
			const removed = removeTheme(name, cwd);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: removed }));
		} catch (err: any) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

	res.writeHead(404);
	res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`[Learn Settings] Server running at http://127.0.0.1:${PORT}`);
	console.log("[Learn Settings] Press Ctrl+C to close.");

	// Auto-launch the browser
	const startCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
	childProcess.exec(`${startCmd} http://127.0.0.1:${PORT}`, () => {});
});
