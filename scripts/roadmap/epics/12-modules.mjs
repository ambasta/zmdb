// The last epic: the module graph as something you can defer, inspect and poke at. Three pages that
// all describe the same object from different angles.

export const MODULE_EPICS = [
  {
    key: 'modulegraph',
    title: '[EPIC] The module graph as a first-class object — lazy loading, an inspector, and a REPL',
    labels: ['enhancement', 'area:web', 'area:cli', 'parity:nestjs'],
    pages: ['web-lazy-modules', 'web-devtools', 'web-repl'],
    packages: ['@zmdb/web', '@zmdb/zmdb'],
    motivation: `
"compileModule resolves the whole graph at createApp; there is no lazy module loader", "no module-graph
inspector", "no REPL entry point that boots the container".

The first note is precise about the current behaviour: \`createApp\` calls \`compileModule(rootModule)\`
(packages/web/src/app/index.ts:27) which walks the whole graph eagerly (packages/web/src/modules/index.ts:65).
That is a defensible default — eager resolution means a misconfiguration fails at startup rather than on
the first request that touches the broken module, which is exactly the right trade for a server. So the
lazy loader has to be additive and opt-in, and the spec should say plainly that eager stays the default and
why. A lazy loader that silently defers configuration errors to runtime would make the product worse.

Where lazy loading genuinely earns its place is a serverless cold start, a CLI that boots one module out of
forty, and a monolith with a rarely used admin surface. Those are real, and they share a requirement: the
deferred module must still be *validated* eagerly even if it is not *instantiated*. Splitting those two
things is the interesting design work here, and it is what makes lazy loading safe rather than a way to
postpone failure.

The other two are developer tools over the same graph, and they are cheap once the graph is a value you can
ask questions of. An inspector answers "what depends on this?" and "why is this a singleton?" — questions
that are annoying to answer by reading code and trivial to answer from the compiled graph. A REPL that boots
the container gives an interactive way to call a repository against a real database, which is the single most
useful debugging affordance a data layer can offer.

The REPL has a security dimension worth designing for rather than bolting on: it is a shell with full
container access and live database credentials. It must be explicit to start, never reachable over a network,
and never something a production process can be talked into opening.
`,
    dod: [
      'Modules can be declared lazy and are instantiated on first use, while still being validated at startup so a misconfiguration fails eagerly.',
      'Eager resolution stays the default, and the docs explain why.',
      'The compiled graph is inspectable: providers, scopes, dependencies, reverse dependencies, controllers and cycles, available programmatically and as CLI output.',
      'The inspector can emit a graph a human can read (text and a diagram format), useful on a graph of realistic size.',
      'A REPL boots the container, exposes resolved providers and repositories, and is loopback-only and explicitly invoked, never network-reachable.',
      'Nothing in the REPL or inspector path is importable into a production request path by accident — enforced, not documented.',
      'All three pages flip to supported.',
    ],
    invariants: [
      '§1 cost model: the graph metadata the inspector needs must not be retained at runtime unless asked for. If describing the graph requires keeping every provider descriptor alive in a production process, that is a memory cost for a development feature.',
      '§2.7 no hidden state: a lazily instantiated module is still owned by its container, with the same lifecycle hooks in the same order. Lazy must not mean "outside the lifecycle".',
      '§2.5 no `as`: a lazily resolved provider is typed exactly as an eager one. The laziness is in when, not in what.',
      'Fail early where possible: lazy defers instantiation, never validation. A missing provider in a lazy module is a startup error.',
      'The REPL is a development tool. It is explicitly invoked, loopback-only if it listens at all, and structurally separated from the server entry point.',
    ],
    nonGoals: [
      'Hot module replacement.',
      'A web UI for the inspector. Programmatic access and CLI output are the scope; a UI can be built on them later.',
      'Changing the default resolution strategy.',
    ],
    subs: [
      {
        key: 'spec',
        title: "[Spec Freeze] lazy semantics, what the graph exposes, and the REPL's boundaries",
        labels: ['spec'],
        goal: "Freeze what lazy means (validated eagerly, instantiated late), the lifecycle ordering for a late module, the graph description API, and the REPL's invocation and access boundaries. No code.",
        why: 'The lifecycle question is the subtle one. `OnModuleInit` on a lazy module cannot run at startup — so when does it run, what happens if it fails on the first request, and does the request that triggered it fail or wait? Those need answers before code, because each one is observable behaviour someone will depend on.',
        files: [
          '`packages/web/src/modules/SPEC.md` — lazy semantics and graph description.',
          '`packages/web/src/devtools/SPEC.md` (new)',
          '`packages/zmdb/src/cli/SPEC.md` — the `repl` and `graph` commands.',
        ],
        api: `
export declare function LazyModule(module: ModuleClass): LazyModuleRef;
export interface LazyModuleRef {
  /** Resolved on first access; validated at startup. */
  load(): Promise<CompiledModule>;
  readonly loaded: boolean;
}

export interface GraphDescription {
  readonly modules: readonly { readonly name: string; readonly lazy: boolean; readonly imports: readonly string[] }[];
  readonly providers: readonly { readonly token: string; readonly module: string; readonly scope: Scope; readonly dependencies: readonly string[] }[];
  readonly controllers: readonly { readonly name: string; readonly module: string; readonly routes: readonly string[] }[];
}
export declare function describeGraph(app: App): GraphDescription;
`,
        steps: [
          'State that eager stays the default, with the reason: a startup failure is better than a first-request failure. Then specify lazy as opt-in per module.',
          "Specify the validation-eager/instantiate-late split precisely: at startup, every lazy module's provider graph is checked for unresolved tokens, cycles and scope conflicts, without constructing anything. Say exactly which errors are catchable this way and which genuinely cannot be (a provider factory that throws, for instance) — being honest about the residue is part of the spec.",
          'Specify lifecycle for a lazy module: when `OnModuleInit` runs, whether the triggering request waits, what happens if init fails (does the module stay unloaded and retry on the next request, or is it permanently failed?), and whether `OnApplicationBootstrap` is skipped or deferred. Also specify shutdown for a module that was never loaded.',
          'Specify concurrency: two simultaneous requests triggering the same lazy module must load it once. Say how (a shared promise) and that a failed load does not leave a poisoned promise cached — that is the bug this always has.',
          'Specify what `describeGraph` exposes, and where the data comes from. Then decide the retention question: is the description built at startup and kept, or reconstructed on demand? On demand is better for the cost model — specify how, since the eager path may discard what it does not need.',
          "Specify the inspector's output formats: a text tree, a machine-readable form, and a diagram format (Mermaid or DOT). Specify what happens on a large graph — a diagram of 200 providers is unreadable, so specify filtering (by module, by depth, by token) as part of the feature rather than an afterthought.",
          'Specify the cycle report: not just that a cycle exists, but the path, because that is what makes it actionable.',
          'Specify the REPL: how it is started (a CLI subcommand, explicitly), what is exposed in scope, that history is kept somewhere sensible, and — the important part — that it does not listen on a socket by default, and if an inspect protocol is used it binds to loopback only. State that it must not be startable from a running server process.',
          'Specify how the REPL and inspector are kept out of production bundles: separate subpaths, and a verifier assertion that the server entry point does not import them.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Eager default reaffirmed with its reason; lazy specified as opt-in.',
          'Validation-eager/instantiate-late split specified, including which errors cannot be caught early.',
          'Full lifecycle semantics for lazy modules including init failure, retry policy and never-loaded shutdown.',
          'Concurrent-load behaviour specified with no poisoned-promise caching.',
          'Graph description contents, retention strategy, output formats, large-graph filtering and actionable cycle paths specified.',
          'REPL invocation, scope, loopback-only rule and production-separation mechanism specified.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] lazy lifecycle and failure paths, graph accuracy, REPL boundaries',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests: lazy loading including concurrent and failing loads, graph description accuracy against a non-trivial fixture app, and the boundary assertions for the REPL.',
        why: 'The lazy failure paths are where the bugs are — a cached rejected promise, a lifecycle hook that runs twice, a shutdown that skips a loaded module. And the graph tests need a realistically shaped fixture, because a graph description is trivially correct for three providers and interesting for thirty.',
        files: [
          '`packages/web/src/modules/lazy.spec.ts` (new)',
          '`packages/web/src/devtools/devtools.spec.ts` (new)',
          '`packages/web/src/modules/__fixtures__/large-graph.ts` (new)',
        ],
        tests: [
          '`does not instantiate a lazy module at startup` — assert the constructor never ran.',
          '`fails at startup when a lazy module has an unresolved token` — the validation-eager guarantee, and the reason lazy is safe.',
          '`fails at startup when a lazy module introduces a cycle`.',
          '`instantiates a lazy module on first use and reuses it afterwards`.',
          '`loads once when two requests trigger the same lazy module concurrently` — assert one construction.',
          '`does not cache a failed load, and retries per the specified policy` — the poisoned-promise test.',
          '`runs OnModuleInit for a lazy module at the specified point, exactly once`.',
          '`runs shutdown hooks only for modules that were loaded`.',
          '`types a lazily resolved provider identically to an eager one` — type-test, no casts.',
          '`describes every provider, scope and dependency for the fixture app` — a golden description over the large fixture.',
          '`reports reverse dependencies for a token`.',
          '`reports a cycle with its full path`.',
          '`emits a text tree and a diagram for the fixture graph`.',
          '`filters a large graph by module and by depth` — assert the output is bounded.',
          '`does not retain graph metadata when the description was never requested` — the §1 assertion, measured.',
          '`the server entry point does not import the repl or devtools` — a module-graph assertion, which is the enforcement rather than a convention.',
          '`the repl does not listen on a non-loopback address`.',
        ],
        steps: [
          'Build the large fixture app with enough shape to be interesting — nested imports, mixed scopes, a cycle in a variant, a lazy module — since every graph test reads better against one realistic fixture than several toy ones.',
          'Write the retention test with a real measurement rather than an inference; this is the kind of claim that decays silently.',
          'Write the import-boundary test as a module-graph walk from the server entry point, in the style of the existing `verify:*` scripts, so it can also become a permanent gate.',
        ],
        dod: [
          'Lazy validation-eager guarantee tested for unresolved tokens and cycles.',
          'Concurrent load, failed load retry, init-once and never-loaded shutdown all tested.',
          'Lazy provider typing checked at the type level.',
          'Graph description asserted against a realistic fixture including reverse dependencies and cycle paths.',
          'Large-graph filtering, retention cost and the production import boundary all asserted.',
        ],
      },
      {
        key: 'lazy',
        title: 'Lazy modules — deferred instantiation, eager validation',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship opt-in lazy modules validated at startup and instantiated on first use, with correct lifecycle, concurrency and failure behaviour.',
        why: 'The load-bearing slice. The valuable property is not deferral, it is deferral without losing the startup failure — which is what keeps lazy from being a way to hide misconfiguration until production.',
        files: [
          '`packages/web/src/modules/index.ts` — `compileModule`, lazy handling.',
          '`packages/web/src/app/index.ts` — lifecycle for late modules.',
          '`packages/web/src/di/index.ts` — resolution through a lazy boundary.',
        ],
        steps: [
          'Split `compileModule` into a validation pass and an instantiation pass, so a lazy module can be validated without being constructed. This is the core change and it should also make the eager path clearer.',
          'Validate unresolved tokens, cycles and scope conflicts across lazy boundaries at startup, and report them with the module named.',
          "Implement loading with a shared promise so concurrent triggers load once, and clear the cached promise on failure so a retry is possible — per the spec's retry policy.",
          'Run lifecycle hooks at the specified point, exactly once, and make sure a module that was never loaded is skipped at shutdown while a loaded one is not.',
          "Keep the resolved provider's type identical to the eager case, with no assertions (§2.5).",
          "Keep the eager path's performance unchanged — run the existing app-startup benchmark if there is one, and add one if there is not, since a two-pass compile is exactly the change that could cost startup time.",
        ],
        tests: [
          'All lazy tests green, including the concurrency and failed-load cases.',
          '`types a lazily resolved provider identically to an eager one`.',
          'Existing module and app suites unchanged; startup performance unchanged.',
        ],
        dod: [
          'Two-pass compile with startup validation across lazy boundaries; eager default and behaviour unchanged.',
          'Single load under concurrency, no poisoned promise, lifecycle hooks exactly once, shutdown correct for never-loaded modules.',
          'Identical typing with no casts; startup performance measured.',
        ],
      },
      {
        key: 'inspector',
        title: 'The module-graph inspector',
        labels: ['enhancement'],
        blockedBy: ['lazy'],
        goal: 'Ship `describeGraph` plus text, machine-readable and diagram output with filtering, on a devtools subpath that production never imports.',
        files: [
          '`packages/web/src/devtools/index.ts` (new)',
          '`packages/web/package.json` — a `./devtools` subpath.',
          '`packages/zmdb/src/cli/commands/graph.ts` (new)',
          '`scripts/verify-devtools-boundary.mjs` (new)',
        ],
        steps: [
          'Build the description on demand from what the compile passes know, retaining nothing extra when it is not requested — reconstructing is cheap and a permanent retention is not.',
          'Compute reverse dependencies, which is the query that actually answers "can I change this?".',
          'Report cycles with the full path, since a cycle without its path is a puzzle rather than a diagnostic.',
          'Emit a text tree, a machine-readable form and a diagram format, and implement the filtering as a first-class option — an unfiltered diagram of a real app is noise, and shipping it without filtering means shipping something nobody uses twice.',
          'Add a CLI command so this is reachable without writing a script, which is most of its value.',
          'Add the boundary verifier to the `verify:*` family so the devtools subpath can never be pulled into the server path, and wire it into CI alongside the others.',
        ],
        tests: [
          'All graph description and output tests green against the large fixture, including filtering and cycle paths.',
          '`does not retain graph metadata when the description was never requested`.',
          'The new boundary verifier green in CI.',
        ],
        dod: [
          'Description built on demand with nothing extra retained; reverse dependencies and cycle paths reported.',
          'Three output formats with real filtering; a CLI command ships.',
          'A `verify:*` gate enforces the production boundary.',
        ],
      },
      {
        key: 'repl',
        title: 'The REPL',
        labels: ['enhancement'],
        blockedBy: ['lazy'],
        goal: 'Ship a CLI REPL that boots the container with providers and repositories in scope, explicitly invoked, loopback-only, and structurally separate from the server.',
        why: 'Small and high-value: an interactive prompt with a live container and real repositories is the fastest way to answer a question about data. The care needed is entirely about access — it is a shell with database credentials.',
        files: [
          '`packages/zmdb/src/cli/commands/repl.ts` (new)',
          '`packages/web/src/testing/index.ts` — reuse for booting without listening.',
        ],
        steps: [
          'Boot the app without starting the HTTP listener — the existing testing harness already boots a container without a server, so build on that rather than adding a third boot path.',
          'Expose resolved providers, repositories and the container itself in scope, and print what is available on start so the tool is discoverable without documentation.',
          'Keep history in a sensible per-project location, and be careful not to write query text containing sensitive values into a shared or committed location — a history file with production data in it is a real leak. Document where it goes and how to disable it.',
          'If the inspect protocol is used for a debugger attach, bind loopback only and never expose a port by default. State the same rule in code, not only in docs.',
          'Make it impossible to start from a running server process: the entry point lives in the CLI package on its own path, and the boundary verifier covers it.',
          'Shut down cleanly on exit, releasing connections through the normal lifecycle so a REPL session does not leak a pool.',
          'Support top-level await and print a promise result rather than `Promise { <pending> }`, since almost every useful call is async — a REPL that makes people write `.then(console.log)` will not get used.',
        ],
        tests: [
          '`boots the container and resolves a provider in the repl scope`.',
          '`does not start an HTTP listener`.',
          '`the repl does not listen on a non-loopback address`.',
          '`awaits and prints a promise result`.',
          '`releases connections on exit`.',
        ],
        dod: [
          'Boots through the existing container-only path; providers and repositories in scope and advertised on start.',
          'History location documented and disableable; no non-loopback binding; unstartable from a server process and covered by the verifier.',
          'Async ergonomics work; clean shutdown releases the pool.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] lazy modules, the graph inspector, and the REPL',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['inspector', 'repl'],
        goal: "Flip all three pages to supported, with the eager-by-default reasoning stated and the REPL's access boundaries documented.",
        files: [
          '`docs-site/pages.mjs`',
          'the three content files',
          '`docs-site/content/web-modules.md` — link lazy loading.',
        ],
        steps: [
          'Open the lazy page with why eager is the default, then when lazy is worth it (cold starts, CLIs, rarely used surfaces). A reader should leave knowing lazy is a tool for specific situations, not a general improvement.',
          'Document the validation-eager guarantee prominently, and be honest about the residue — the errors that still only appear on first load.',
          'Document the lifecycle timing and the failed-load retry policy, since both are observable.',
          'Write the inspector page from real output against the large fixture, including a filtered diagram — an unreadable 200-node diagram on the docs page would undersell the feature.',
          'Show the reverse-dependency query and the cycle report, which are the two things people will actually use it for.',
          "Document the REPL's boundaries plainly: development only, explicitly started, loopback only, and where history is written.",
          'Refresh README counts and cross-link from the modules page.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Three pages supported; eager-default reasoning and the validation-eager guarantee documented with its honest residue; inspector output shown from the real fixture; REPL boundaries stated plainly.',
        ],
      },
    ],
  },
];
