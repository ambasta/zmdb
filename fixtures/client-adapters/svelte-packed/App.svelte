<script>
  import Child from './Child.svelte.js';
  import { zmdb } from './bindings.mjs';

  let { client } = $props();
  zmdb.setClient(client);
</script>

<Child />
