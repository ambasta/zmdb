// zmdb participant entry point for the-benchmarker/web-frameworks.
//
// The contract app itself is benchmarks/harness/framework/app.ts — the same file
// the standalone harness runs, kept in one place so the upstream participant and
// our own reproduction cannot drift into measuring different servers. This file
// only exists to give esbuild a bundle entry inside the upstream tree.
//
// Depth: this lives at benchmarks/upstream/web-frameworks/javascript/zmdb, so
// four levels up is benchmarks/.
import '../../../../harness/framework/app.ts';
