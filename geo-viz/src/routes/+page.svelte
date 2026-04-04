<script lang="ts">
	import { onMount } from 'svelte';

	let visible = $state(false);
	onMount(() => { visible = true; });

	const features = [
		{
			title: 'Zero Infrastructure',
			desc: 'No servers, no installs, no IT involvement. DuckDB-WASM processes everything client-side. Data never leaves the device.',
		},
		{
			title: '30-Second Time to Insight',
			desc: 'Upload a CSV. See a hexagonal heatmap. No import wizards, no project setup, no schema configuration.',
		},
		{
			title: 'Multi-Layer Comparison',
			desc: 'Load multiple datasets as independent layers and compare them side-by-side on a single map with per-layer controls.',
		},
		{
			title: 'H3 Hexagonal Aggregation',
			desc: 'Uber\'s H3 spatial index provides uniform-area cells at any resolution — city block to sub-meter.',
		},
		{
			title: 'Raster Overlay',
			desc: 'Import MapInfo .TAB raster files to overlay reference imagery alongside your aggregated data.',
		},
		{
			title: 'Time-Series Animation',
			desc: 'Scrub and animate through temporal data. Compare snapshots, detect patterns, and export results.',
		}
	];

	const steps = [
		{ num: '1', title: 'Upload', desc: 'Drop a CSV or ZIP. Column schemas — latitude, longitude, and any numeric fields — are auto-detected.' },
		{ num: '2', title: 'Process', desc: 'DuckDB-WASM aggregates rows into H3 hexagonal cells in-browser. All data stays local.' },
		{ num: '3', title: 'Analyze', desc: 'Filter, compare layers, animate over time, and export results.' }
	];

	const processHexes = [
		{x:80,y:55,c:'#1a9850'},{x:110,y:55,c:'#91cf60'},{x:140,y:55,c:'#d9ef8b'},
		{x:65,y:80,c:'#91cf60'},{x:95,y:80,c:'#fee08b'},{x:125,y:80,c:'#1a9850'},{x:155,y:80,c:'#fc8d59'},
		{x:80,y:105,c:'#d9ef8b'},{x:110,y:105,c:'#d73027'},{x:140,y:105,c:'#fee08b'},
		{x:95,y:130,c:'#fc8d59'},{x:125,y:130,c:'#91cf60'},{x:155,y:130,c:'#1a9850'}
	];

	const mapHexes = [
		{x:70,y:50,c:'#1a9850'},{x:95,y:50,c:'#91cf60'},{x:120,y:50,c:'#1a9850'},
		{x:57,y:70,c:'#d9ef8b'},{x:82,y:70,c:'#fee08b'},{x:107,y:70,c:'#91cf60'},{x:132,y:70,c:'#fc8d59'},
		{x:70,y:90,c:'#1a9850'},{x:95,y:90,c:'#d73027'},{x:120,y:90,c:'#fee08b'},{x:145,y:90,c:'#91cf60'},
		{x:82,y:110,c:'#fc8d59'},{x:107,y:110,c:'#1a9850'},{x:132,y:110,c:'#d9ef8b'}
	];

	const plans = [
		{
			name: 'Explore',
			price: 'Free',
			unit: '',
			desc: 'Individual analysts',
			items: ['Single layer, single file', 'All metrics & resolutions', 'Up to 50 MB', 'No signup required'],
			cta: 'Launch Free',
			href: '/app',
			primary: false
		},
		{
			name: 'Pro',
			price: '$99',
			unit: '/mo',
			desc: 'Power users & consultants',
			items: ['Unlimited layers & files', 'Time-series animation', 'Raster overlay', 'PNG / GeoJSON export', 'Priority support'],
			cta: 'Start Pro Trial',
			href: '/app',
			primary: true
		},
		{
			name: 'Team',
			price: '$79',
			unit: '/seat/mo',
			desc: 'Teams & organizations',
			items: ['Everything in Pro', 'Min 5 seats', 'Shared project links', 'Custom branding', 'SSO (SAML / OIDC)'],
			cta: 'Contact Sales',
			href: '#',
			primary: false
		},
		{
			name: 'Enterprise',
			price: 'Custom',
			unit: '',
			desc: 'Large organizations',
			items: ['Everything in Team', 'Self-hosted deployment', 'Custom connectors', 'Dedicated onboarding', 'SLA guarantees'],
			cta: 'Contact Sales',
			href: '#',
			primary: false
		}
	];
</script>

<svelte:head>
	<title>GeoViz — Browser-Based Geospatial Data Visualization</title>
	<meta name="description" content="Visualize any geospatial CSV data in seconds. Zero infrastructure. No data leaves your device." />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="page" class:visible>

	<!-- Shared SVG defs -->
	<svg width="0" height="0" style="position:absolute">
		<defs>
			<linearGradient id="g-brand" x1="0%" y1="0%" x2="100%" y2="100%">
				<stop offset="0%" stop-color="#22c55e"/>
				<stop offset="100%" stop-color="#3b82f6"/>
			</linearGradient>
			<linearGradient id="g-ramp" x1="0%" y1="0%" x2="100%" y2="0%">
				<stop offset="0%" stop-color="#1a9850"/>
				<stop offset="20%" stop-color="#91cf60"/>
				<stop offset="40%" stop-color="#d9ef8b"/>
				<stop offset="60%" stop-color="#fee08b"/>
				<stop offset="80%" stop-color="#fc8d59"/>
				<stop offset="100%" stop-color="#d73027"/>
			</linearGradient>
			<linearGradient id="g-sky" x1="0%" y1="0%" x2="0%" y2="100%">
				<stop offset="0%" stop-color="#f0f4f8"/>
				<stop offset="100%" stop-color="#e2e8f0"/>
			</linearGradient>
		</defs>
	</svg>

	<!-- Nav -->
	<nav class="nav">
		<div class="nav-inner">
			<a href="/" class="nav-brand">
				<div class="brand-mark">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
						<path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" fill="none" stroke="url(#g-brand)" stroke-width="1.5"/>
						<path d="M12 7L7 10v6l5 3 5-3v-6l-5-3z" fill="url(#g-brand)" opacity="0.3"/>
						<circle cx="12" cy="12" r="2" fill="url(#g-brand)"/>
					</svg>
				</div>
				GeoViz
			</a>
			<div class="nav-right">
				<a href="#features" class="nav-link">Features</a>
				<a href="#pricing" class="nav-link">Pricing</a>
				<a href="/app" class="nav-btn">Open App</a>
			</div>
		</div>
	</nav>

	<!-- ══════ HERO ══════ -->
	<section class="hero">
		<div class="hero-split">
			<div class="hero-text">
				<p class="overline">GEOSPATIAL DATA VISUALIZATION</p>
				<h1>Any CSV with coordinates,<br />mapped in seconds.</h1>
				<p class="hero-body">
					Upload a CSV. Get an interactive H3 hexagonal heatmap of any numeric column —
					multi-layer comparison, time animation, and raster overlay.
					Entirely in the browser. No servers. No installs.
				</p>
				<div class="hero-actions">
					<a href="/app" class="btn-primary">Launch App</a>
					<span class="hero-aside">Free tier &middot; No signup &middot; No credit card</span>
				</div>
			</div>
			<div class="hero-visual">
				<svg viewBox="0 0 480 400" fill="none" class="hero-svg">
					<!-- Sky -->
					<rect width="480" height="400" fill="url(#g-sky)"/>

					<!-- Hex grid background -->
					{#each Array(8) as _, row}
						{#each Array(7) as _, col}
							{@const cx = col * 56 + (row % 2 ? 28 : 0) + 60}
							{@const cy = row * 48 + 40}
							{@const colors = ['#1a985020', '#91cf6020', '#d9ef8b25', '#fee08b25', '#fc8d5920', '#d7302718']}
							{@const ci = (row * 7 + col) % colors.length}
							<polygon
								points="{cx},{cy-22} {cx+19},{cy-11} {cx+19},{cy+11} {cx},{cy+22} {cx-19},{cy+11} {cx-19},{cy-11}"
								fill={colors[ci]}
								stroke="#cbd5e1"
								stroke-width="0.5"
								opacity="0.7"
							/>
						{/each}
					{/each}

					<!-- Buildings -->
					<rect x="40" y="200" width="36" height="180" fill="#64748b" rx="2"/>
					<rect x="44" y="208" width="8" height="10" fill="#94a3b830" rx="1"/>
					<rect x="56" y="208" width="8" height="10" fill="#94a3b830" rx="1"/>
					<rect x="44" y="224" width="8" height="10" fill="#94a3b830" rx="1"/>
					<rect x="56" y="224" width="8" height="10" fill="#94a3b830" rx="1"/>

					<rect x="84" y="160" width="44" height="220" fill="#475569" rx="2"/>
					<rect x="90" y="168" width="10" height="12" fill="#94a3b830" rx="1"/>
					<rect x="106" y="168" width="10" height="12" fill="#94a3b830" rx="1"/>
					<rect x="90" y="186" width="10" height="12" fill="#94a3b830" rx="1"/>
					<rect x="106" y="186" width="10" height="12" fill="#94a3b830" rx="1"/>

					<rect x="136" y="240" width="32" height="140" fill="#94a3b8" rx="2"/>

					<rect x="176" y="120" width="50" height="260" fill="#334155" rx="2"/>
					<rect x="182" y="128" width="10" height="12" fill="#94a3b820" rx="1"/>
					<rect x="198" y="128" width="10" height="12" fill="#94a3b820" rx="1"/>
					<rect x="182" y="146" width="10" height="12" fill="#94a3b820" rx="1"/>
					<rect x="198" y="146" width="10" height="12" fill="#94a3b820" rx="1"/>

					<!-- Data flow lines from tallest building -->
					<path d="M 201 130 Q 240 90, 290 100" stroke="#22c55e" stroke-width="1.5" fill="none" opacity="0.5" stroke-dasharray="4 3">
						<animate attributeName="stroke-dashoffset" from="0" to="-14" dur="2s" repeatCount="indefinite"/>
					</path>
					<path d="M 201 130 Q 260 70, 360 80" stroke="#3b82f6" stroke-width="1" fill="none" opacity="0.3" stroke-dasharray="4 3">
						<animate attributeName="stroke-dashoffset" from="0" to="-14" dur="2.5s" repeatCount="indefinite"/>
					</path>
					<path d="M 201 130 Q 230 150, 270 170" stroke="#22c55e" stroke-width="1.5" fill="none" opacity="0.4" stroke-dasharray="4 3">
						<animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.8s" repeatCount="indefinite"/>
					</path>

					<!-- Right-side buildings -->
					<rect x="240" y="260" width="28" height="120" fill="#94a3b8" rx="2"/>
					<rect x="276" y="220" width="38" height="160" fill="#64748b" rx="2"/>
					<rect x="322" y="280" width="30" height="100" fill="#94a3b8" rx="2"/>
					<rect x="360" y="190" width="42" height="190" fill="#475569" rx="2"/>
					<rect x="410" y="300" width="36" height="80" fill="#94a3b8" rx="2"/>

					<!-- Colored hex overlay (data cells) -->
					<polygon points="100,300 118,290 118,310 100,320 82,310 82,290" fill="#1a9850" opacity="0.25" stroke="#1a9850" stroke-width="0.5"/>
					<polygon points="155,320 173,310 173,330 155,340 137,330 137,310" fill="#91cf60" opacity="0.25" stroke="#91cf60" stroke-width="0.5"/>
					<polygon points="210,310 228,300 228,320 210,330 192,320 192,300" fill="#d9ef8b" opacity="0.3" stroke="#d9ef8b" stroke-width="0.5"/>
					<polygon points="265,330 283,320 283,340 265,350 247,340 247,320" fill="#fee08b" opacity="0.3" stroke="#fee08b" stroke-width="0.5"/>
					<polygon points="320,340 338,330 338,350 320,360 302,350 302,330" fill="#fc8d59" opacity="0.25" stroke="#fc8d59" stroke-width="0.5"/>
					<polygon points="375,320 393,310 393,330 375,340 357,330 357,310" fill="#d73027" opacity="0.2" stroke="#d73027" stroke-width="0.5"/>

					<!-- Ground plane -->
					<rect x="0" y="378" width="480" height="22" fill="#e2e8f0"/>
					<rect x="0" y="378" width="480" height="3" fill="url(#g-ramp)" opacity="0.6"/>
				</svg>
			</div>
		</div>
		<div class="hero-bar">
			<div class="hero-stat">
				<span class="stat-val">&lt; 30s</span>
				<span class="stat-label">Time to first map</span>
			</div>
			<div class="hero-stat">
				<span class="stat-val">0 bytes</span>
				<span class="stat-label">Sent to any server</span>
			</div>
			<div class="hero-stat">
				<span class="stat-val">Any CSV</span>
				<span class="stat-label">With lat/lon columns</span>
			</div>
		</div>
	</section>

	<!-- Color ramp accent -->
	<div class="ramp"></div>

	<!-- ══════ FEATURES ══════ -->
	<section class="section section-hex-bg" id="features">
		<div class="contain">
			<p class="overline">CAPABILITIES</p>
			<h2>Built for analysts,<br class="hide-sm" /> not IT departments.</h2>
			<div class="feature-grid">
				{#each features as f, i}
					<div class="feature-card">
						<span class="feature-num">{String(i + 1).padStart(2, '0')}</span>
						<h3>{f.title}</h3>
						<p>{f.desc}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ══════ HOW IT WORKS ══════ -->
	<section class="section section-alt">
		<div class="contain">
			<p class="overline">WORKFLOW</p>
			<h2>Three steps. Thirty seconds.</h2>
			<div class="steps-illustrated">
				{#each steps as s, i}
					<div class="step-row" class:step-row-reverse={i % 2 === 1}>
						<div class="step-illust">
							{#if i === 0}
								<svg viewBox="0 0 240 180" fill="none" class="step-svg">
									<rect width="240" height="180" rx="8" fill="#f8fafc"/>
									<rect x="80" y="20" width="50" height="60" rx="3" fill="#fff" stroke="#cbd5e1" stroke-width="1.5"/>
									<path d="M110 20L130 40" stroke="#cbd5e1" stroke-width="1.5"/>
									<rect x="110" y="20" width="20" height="20" rx="2" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>
									<line x1="90" y1="45" x2="120" y2="45" stroke="#e2e8f0" stroke-width="2"/>
									<line x1="90" y1="52" x2="115" y2="52" stroke="#e2e8f0" stroke-width="2"/>
									<line x1="90" y1="59" x2="118" y2="59" stroke="#e2e8f0" stroke-width="2"/>
									<text x="92" y="42" font-size="6" fill="#94a3b8" font-family="monospace">.CSV</text>
									<path d="M105 88 L105 110" stroke="url(#g-brand)" stroke-width="2" stroke-dasharray="4 3">
										<animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite"/>
									</path>
									<polygon points="99,108 105,118 111,108" fill="url(#g-brand)"/>
									<polygon points="105,125 125,135 125,155 105,165 85,155 85,135" fill="#22c55e" opacity="0.15" stroke="#22c55e" stroke-width="1.5"/>
									<text x="93" y="153" font-size="8" fill="#22c55e" font-family="monospace" font-weight="600">H3</text>
								</svg>
							{:else if i === 1}
								<svg viewBox="0 0 240 180" fill="none" class="step-svg">
									<rect width="240" height="180" rx="8" fill="#f8fafc"/>
									{#each processHexes as h, hi}
										<polygon
											points="{h.x},{h.y-12} {h.x+14},{h.y-6} {h.x+14},{h.y+6} {h.x},{h.y+12} {h.x-14},{h.y+6} {h.x-14},{h.y-6}"
											fill={h.c} opacity="0.3" stroke={h.c} stroke-width="1"
										>
											<animate attributeName="opacity" values="0;0.3;0.3" dur="0.4s" begin="{hi * 0.08}s" fill="freeze"/>
										</polygon>
									{/each}
									<circle cx="195" cy="40" r="14" stroke="#94a3b8" stroke-width="1.5" fill="#f1f5f9" stroke-dasharray="3 2">
										<animateTransform attributeName="transform" type="rotate" values="0 195 40;360 195 40" dur="4s" repeatCount="indefinite"/>
									</circle>
									<text x="188" y="44" font-size="10" fill="#64748b" font-family="monospace" font-weight="600">⚙</text>
								</svg>
							{:else}
								<svg viewBox="0 0 240 180" fill="none" class="step-svg">
									<rect width="240" height="180" rx="8" fill="#f8fafc"/>
									<rect x="30" y="20" width="160" height="120" rx="4" fill="#fff" stroke="#e2e8f0" stroke-width="1.5"/>
									{#each mapHexes as h}
										<polygon
											points="{h.x},{h.y-9} {h.x+10},{h.y-5} {h.x+10},{h.y+5} {h.x},{h.y+9} {h.x-10},{h.y+5} {h.x-10},{h.y-5}"
											fill={h.c} opacity="0.4" stroke={h.c} stroke-width="0.5"
										/>
									{/each}
									<rect x="195" y="40" width="30" height="18" rx="2" fill="#22c55e" opacity="0.2" stroke="#22c55e" stroke-width="1"/>
									<rect x="198" y="34" width="30" height="18" rx="2" fill="#3b82f6" opacity="0.2" stroke="#3b82f6" stroke-width="1"/>
									<rect x="201" y="28" width="30" height="18" rx="2" fill="#f59e0b" opacity="0.2" stroke="#f59e0b" stroke-width="1"/>
									<text x="195" y="72" font-size="7" fill="#64748b" font-family="monospace">Layers</text>
									<rect x="30" y="148" width="160" height="6" rx="3" fill="url(#g-ramp)" opacity="0.5"/>
									<text x="30" y="164" font-size="6" fill="#94a3b8" font-family="monospace">min</text>
									<text x="175" y="164" font-size="6" fill="#94a3b8" font-family="monospace">max</text>
								</svg>
							{/if}
						</div>
						<div class="step-content">
							<span class="step-num">{s.num}</span>
							<h3>{s.title}</h3>
							<p>{s.desc}</p>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Pricing -->
	<section class="section" id="pricing">
		<div class="contain">
			<p class="overline">PRICING</p>
			<h2>Start free. Scale when ready.</h2>
			<div class="pricing-grid">
				{#each plans as p}
					<div class="plan" class:plan-pop={p.primary}>
						{#if p.primary}<div class="plan-badge">Recommended</div>{/if}
						<div class="plan-header">
							<h3>{p.name}</h3>
							<p class="plan-desc">{p.desc}</p>
							<div class="plan-price">{p.price}<span class="plan-unit">{p.unit}</span></div>
						</div>
						<ul>
							{#each p.items as item}
								<li>{item}</li>
							{/each}
						</ul>
						<a href={p.href} class="plan-cta" class:btn-primary={p.primary} class:btn-outline={!p.primary}>
							{p.cta}
						</a>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Final CTA -->
	<section class="final">
		<div class="final-bg">
			<svg viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice" fill="none" class="final-skyline">
				<rect x="0" y="80" width="60" height="120" fill="#e2e8f0"/>
				<rect x="65" y="50" width="80" height="150" fill="#cbd5e1"/>
				<rect x="150" y="100" width="50" height="100" fill="#e2e8f0"/>
				<rect x="205" y="30" width="70" height="170" fill="#cbd5e1"/>
				<rect x="280" y="90" width="55" height="110" fill="#e2e8f0"/>
				<rect x="340" y="60" width="65" height="140" fill="#cbd5e1"/>
				<rect x="410" y="110" width="45" height="90" fill="#e2e8f0"/>
				<rect x="460" y="40" width="75" height="160" fill="#cbd5e1"/>
				<rect x="540" y="80" width="50" height="120" fill="#e2e8f0"/>
				<rect x="595" y="55" width="70" height="145" fill="#cbd5e1"/>
				<rect x="670" y="100" width="40" height="100" fill="#e2e8f0"/>
				<rect x="715" y="35" width="80" height="165" fill="#cbd5e1"/>
				<rect x="800" y="85" width="55" height="115" fill="#e2e8f0"/>
				<rect x="860" y="65" width="65" height="135" fill="#cbd5e1"/>
				<rect x="930" y="105" width="50" height="95" fill="#e2e8f0"/>
				<rect x="985" y="45" width="70" height="155" fill="#cbd5e1"/>
				<rect x="1060" y="90" width="40" height="110" fill="#e2e8f0"/>
				<rect x="1105" y="70" width="95" height="130" fill="#cbd5e1"/>
				<rect x="0" y="197" width="1200" height="3" fill="url(#g-ramp)" opacity="0.4"/>
			</svg>
		</div>
		<div class="contain final-content">
			<h2>Your data stays on your machine.<br />Your map is 30 seconds away.</h2>
			<a href="/app" class="btn-primary btn-lg">Launch GeoViz</a>
			<p class="final-sub">Free. No signup. Works offline.</p>
		</div>
	</section>

	<!-- Footer -->
	<footer class="footer">
		<div class="contain footer-inner">
			<span class="footer-brand">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" fill="none" stroke="url(#g-brand)" stroke-width="1.5"/>
					<path d="M12 7L7 10v6l5 3 5-3v-6l-5-3z" fill="url(#g-brand)" opacity="0.3"/>
					<circle cx="12" cy="12" r="2" fill="url(#g-brand)"/>
				</svg>
				GeoViz
			</span>
			<span class="footer-tech">DuckDB-WASM &middot; H3 &middot; deck.gl</span>
			<div class="footer-links">
				<a href="/app">App</a>
				<a href="#features">Features</a>
				<a href="#pricing">Pricing</a>
			</div>
		</div>
	</footer>
</div>

<style>
	/* ── Base ── */
	.page {
		--display: 'Sora', system-ui, sans-serif;
		--sans: 'IBM Plex Sans', system-ui, sans-serif;
		--mono: 'IBM Plex Mono', 'SFMono-Regular', monospace;
		--ink: #1a1a1a;
		--ink-2: #444;
		--ink-3: #777;
		--ink-4: #aaa;
		--bg: #ffffff;
		--bg-alt: #f6f5f3;
		--rule: #e4e2de;
		--viz-green: #1a9850;
		--viz-lime: #91cf60;
		--viz-yellow: #d9ef8b;
		--viz-gold: #fee08b;
		--viz-orange: #fc8d59;
		--viz-red: #d73027;
		font-family: var(--sans);
		color: var(--ink);
		background: var(--bg);
		-webkit-font-smoothing: antialiased;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	.page.visible { opacity: 1; }
	.contain { max-width: 980px; margin: 0 auto; padding: 0 28px; }
	.hide-sm { display: inline; }
	@media (max-width: 640px) { .hide-sm { display: none; } }

	/* ── Nav ── */
	.nav {
		position: fixed; top: 0; left: 0; right: 0; z-index: 100;
		background: rgba(255,255,255,0.92);
		backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--rule);
	}
	.nav-inner {
		max-width: 980px; margin: 0 auto; padding: 0 28px;
		height: 56px; display: flex; align-items: center; justify-content: space-between;
	}
	.nav-brand {
		font-family: var(--display); font-weight: 700; font-size: 16px;
		color: var(--ink); text-decoration: none;
		display: flex; align-items: center; gap: 8px; letter-spacing: -0.02em;
	}
	.brand-mark { display: flex; }
	.nav-right { display: flex; align-items: center; gap: 24px; }
	.nav-link {
		font-size: 13px; font-weight: 500; color: var(--ink-3);
		text-decoration: none; transition: color 0.15s;
	}
	.nav-link:hover { color: var(--ink); }
	.nav-btn {
		font-family: var(--mono); font-size: 12px; font-weight: 600;
		color: var(--ink); text-decoration: none;
		padding: 6px 16px; border: 1.5px solid var(--ink); border-radius: 5px;
		transition: background 0.15s, color 0.15s;
	}
	.nav-btn:hover { background: var(--ink); color: #fff; }

	/* ── Hero ── */
	.hero { padding: 120px 0 0; }
	.hero-split {
		display: grid; grid-template-columns: 1fr 1fr;
		gap: 40px; align-items: center;
		max-width: 980px; margin: 0 auto; padding: 0 28px;
	}
	.hero-text { padding-right: 20px; }
	.hero-visual { display: flex; justify-content: center; }
	.hero-svg {
		width: 100%; max-width: 480px; height: auto;
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.06);
	}
	.overline {
		font-family: var(--mono); font-size: 11px; font-weight: 600;
		letter-spacing: 0.14em; color: var(--ink-3); margin: 0 0 16px;
	}
	.hero h1 {
		font-family: var(--display);
		font-size: clamp(28px, 4vw, 44px);
		font-weight: 700; line-height: 1.15;
		letter-spacing: -0.02em; margin: 0; color: var(--ink);
	}
	.hero-body {
		font-size: clamp(14px, 1.6vw, 16px); line-height: 1.7;
		color: var(--ink-2); margin: 16px 0 0;
	}
	.hero-actions {
		margin-top: 28px;
		display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
	}
	.hero-aside { font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
	.hero-bar {
		display: flex; justify-content: center; gap: 48px;
		margin-top: 48px; padding: 28px 0;
		border-top: 1px solid var(--rule);
	}
	.hero-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; }
	.stat-val { font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--ink); }
	.stat-label { font-size: 12px; color: var(--ink-3); }

	/* ── Color ramp accent ── */
	.ramp {
		height: 3px;
		background: linear-gradient(90deg,
			var(--viz-green) 0%, var(--viz-lime) 20%, var(--viz-yellow) 40%,
			var(--viz-gold) 60%, var(--viz-orange) 80%, var(--viz-red) 100%);
	}

	/* ── Sections ── */
	.section { padding: 88px 0; }
	.section-alt { background: var(--bg-alt); }
	.section .overline, .final .overline { text-align: center; }
	.section h2 {
		font-family: var(--display);
		font-size: clamp(24px, 3.5vw, 36px);
		font-weight: 700; line-height: 1.2;
		letter-spacing: -0.015em; text-align: center; margin: 0 0 16px;
	}
	.section-desc {
		text-align: center; color: var(--ink-3); font-size: 16px;
		max-width: 600px; margin: 0 auto 48px;
	}

	/* ── Features ── */
	.section-hex-bg {
		background-image: repeating-linear-gradient(
			60deg,
			transparent,
			transparent 28px,
			rgba(203,213,225,0.15) 28px,
			rgba(203,213,225,0.15) 29px
		),
		repeating-linear-gradient(
			-60deg,
			transparent,
			transparent 28px,
			rgba(203,213,225,0.15) 28px,
			rgba(203,213,225,0.15) 29px
		);
	}
	.feature-grid {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
		margin-top: 48px;
	}
	@media (max-width: 720px) { .feature-grid { grid-template-columns: 1fr 1fr; } }
	@media (max-width: 480px) { .feature-grid { grid-template-columns: 1fr; } }
	.feature-card {
		background: var(--bg); border: 1px solid var(--rule);
		border-radius: 10px; padding: 24px 20px;
	}
	.feature-num {
		font-family: var(--mono); font-size: 11px; font-weight: 600;
		color: var(--ink-4); display: block; margin-bottom: 12px;
	}
	.feature-card h3 {
		font-family: var(--display); font-size: 16px; font-weight: 600;
		color: var(--ink); margin: 0 0 8px;
	}
	.feature-card p { font-size: 14px; color: var(--ink-3); line-height: 1.6; margin: 0; }

	/* ── Steps ── */
	.steps-illustrated { display: flex; flex-direction: column; gap: 64px; margin-top: 60px; }
	.step-row {
		display: grid; grid-template-columns: 1fr 1fr;
		gap: 48px; align-items: center;
	}
	.step-row-reverse { direction: rtl; }
	.step-row-reverse > * { direction: ltr; }
	@media (max-width: 640px) {
		.step-row, .step-row-reverse { grid-template-columns: 1fr; direction: ltr; }
	}
	.step-svg { width: 100%; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
	.step-num {
		font-family: var(--mono); font-size: 36px; font-weight: 700;
		color: var(--rule); display: block; margin-bottom: 12px; line-height: 1;
	}
	.step-content h3 {
		font-family: var(--display); font-size: 22px; font-weight: 700;
		color: var(--ink); margin: 0 0 12px;
	}
	.step-content p { font-size: 15px; color: var(--ink-2); line-height: 1.7; margin: 0; }

	/* ── Buttons ── */
	.btn-primary {
		display: inline-block;
		background: var(--ink); color: #fff;
		padding: 10px 24px; border-radius: 6px;
		font-family: var(--mono); font-size: 13px; font-weight: 600;
		text-decoration: none; transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.85; }
	.btn-lg { padding: 14px 36px; font-size: 15px; }
	.btn-outline {
		display: inline-block;
		background: transparent; color: var(--ink);
		padding: 9px 22px; border-radius: 6px; border: 1.5px solid var(--ink);
		font-family: var(--mono); font-size: 13px; font-weight: 600;
		text-decoration: none; transition: background 0.15s, color 0.15s;
	}
	.btn-outline:hover { background: var(--ink); color: #fff; }

	/* ── Pricing ── */
	.pricing-grid {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
		margin-top: 48px;
	}
	@media (max-width: 800px) { .pricing-grid { grid-template-columns: 1fr 1fr; } }
	@media (max-width: 480px) { .pricing-grid { grid-template-columns: 1fr; } }
	.plan {
		border: 1px solid var(--rule); border-radius: 10px;
		padding: 24px 20px; display: flex; flex-direction: column; gap: 16px;
		position: relative; background: var(--bg);
	}
	.plan-pop { border-color: var(--ink); box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
	.plan-badge {
		position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
		background: var(--ink); color: #fff;
		font-family: var(--mono); font-size: 10px; font-weight: 600;
		padding: 3px 10px; border-radius: 20px; white-space: nowrap;
	}
	.plan-header h3 { font-family: var(--display); font-size: 18px; font-weight: 700; margin: 0 0 4px; }
	.plan-desc { font-size: 12px; color: var(--ink-3); margin: 0 0 12px; }
	.plan-price { font-family: var(--mono); font-size: 28px; font-weight: 700; }
	.plan-unit { font-size: 14px; font-weight: 400; color: var(--ink-3); }
	.plan ul {
		list-style: none; margin: 0; padding: 0;
		display: flex; flex-direction: column; gap: 8px; flex: 1;
	}
	.plan ul li {
		font-size: 13px; color: var(--ink-2);
		padding-left: 16px; position: relative;
	}
	.plan ul li::before { content: '–'; position: absolute; left: 0; color: var(--ink-4); }
	.plan-cta { text-align: center; }

	/* ── Final CTA ── */
	.final { position: relative; overflow: hidden; padding: 100px 0; text-align: center; }
	.final-bg { position: absolute; inset: 0; pointer-events: none; }
	.final-skyline { width: 100%; height: 100%; }
	.final-content { position: relative; }
	.final h2 {
		font-family: var(--display);
		font-size: clamp(24px, 3.5vw, 38px);
		font-weight: 700; line-height: 1.2;
		letter-spacing: -0.015em; margin: 0 0 28px;
	}
	.final-sub { font-family: var(--mono); font-size: 12px; color: var(--ink-4); margin-top: 14px; }

	/* ── Footer ── */
	.footer { border-top: 1px solid var(--rule); padding: 24px 0; }
	.footer-inner {
		display: flex; align-items: center; justify-content: space-between;
		gap: 16px; flex-wrap: wrap;
	}
	.footer-brand {
		font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--ink);
		display: flex; align-items: center; gap: 6px;
	}
	.footer-tech { font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
	.footer-links { display: flex; gap: 20px; }
	.footer-links a { font-size: 13px; color: var(--ink-3); text-decoration: none; }
	.footer-links a:hover { color: var(--ink); }
</style>
