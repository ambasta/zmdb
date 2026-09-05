const jobs = await import('@zmdb/jobs-postgres');

if (typeof jobs.createPgJobStore !== 'function') {
  throw new Error('@zmdb/jobs-postgres omitted createPgJobStore');
}
