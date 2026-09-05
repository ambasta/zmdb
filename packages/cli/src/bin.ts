#!/usr/bin/env node
import { main } from './cli.js';

main().then(
  msg => {
    if (msg) console.log(msg);
    process.exit(0);
  },
  err => {
    console.error(err);
    process.exit(1);
  },
);
